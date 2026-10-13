import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import { createPasswordResetToken } from '../../src/auth/password-reset.js';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administrator: TestUser;
let administratorCookie: string;
let viewerRoleId: string;
const mails: Map<string, string> = new Map<string, string>();
const profile: { firstName: string; lastName: string; displayName: string } = {
  firstName: 'Link',
  lastName: 'Owner',
  displayName: 'Link Owner',
};
const newPassword: string = 'r7!Kp2@Vn9#Wx4$Da8%Gj3^Hs6&Qe1*';

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  administrator = await createTestUser(database.pool, { email: 'link-guard-admin@example.test' });
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [administrator.principalId],
  );
  administratorCookie = await loginCookie(administrator);
  const cookbook: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: administratorCookie },
    payload: { cookbookName: 'Link Guard Kitchen' },
  });
  assert.equal(cookbook.statusCode, 201);
  const roles: QueryResult<{ id: string }> = await database.pool.query(
    "SELECT tenant_role.id FROM tenant_role INNER JOIN tenant ON tenant.id = tenant_role.tenant_id WHERE tenant.slug = 'link-guard-kitchen' AND tenant_role.name = 'Viewer'",
  );
  viewerRoleId = roles.rows[0]!.id;
  await database.pool.query(
    `INSERT INTO instance_mail_settings
     (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id)
     VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)`,
    [administrator.principalId],
  );
  mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: { to: string; text: string }): Promise<void> => {
      mails.set(mail.to, mail.text);
    },
  }));
});

after(async (): Promise<void> => {
  mock.restoreAll();
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

async function loginCookie(user: TestUser): Promise<string> {
  const result: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(result.statusCode, 200);
  const cookie: string | string[] | undefined = result.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return cookie as string;
}

function mailToken(email: string, path: string): string {
  const token: string | undefined = mails
    .get(email)
    ?.match(new RegExp(`/${path}/([A-Za-z0-9_-]+)`))?.[1];
  assert.ok(token);
  return token;
}

async function post(
  url: string,
  payload: object,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url,
    payload,
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function get(url: string, cookie?: string): Promise<LightMyRequestResponse> {
  return api.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });
}

test('self-service and administrator reset links reject a foreign session without changing either account and remain usable anonymously', async (): Promise<void> => {
  const resetModes: boolean[] = [false, true];
  for (const forceChange of resetModes) {
    const user: TestUser = await createTestUser(database.pool, {
      email: `reset-target-${forceChange}@example.test`,
      passwordChangeRequired: forceChange,
    });
    const token: string = await createPasswordResetToken(database.pool, user.userId, forceChange);
    const tokenBefore: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT * FROM password_reset_token WHERE user_account_id = $1',
      [user.userId],
    );
    const accountBefore: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT password_hash, password_change_required, password_changed_at FROM user_account WHERE id = $1',
      [user.userId],
    );
    const details: LightMyRequestResponse = await post(
      '/auth/password-reset/verification',
      { token },
      administratorCookie,
    );
    assert.equal(details.statusCode, 403);
    assert.equal(details.json<{ code: string }>().code, 'PASSWORD_RESET_ACCOUNT_MISMATCH');
    assert.deepEqual(Object.keys(details.json()).sort(), ['code', 'error']);
    const rejected: LightMyRequestResponse = await post(
      '/auth/password-reset/complete',
      { token, newPassword, userId: user.userId, email: user.email },
      administratorCookie,
    );
    assert.equal(rejected.statusCode, 403);
    const tokenAfter: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT * FROM password_reset_token WHERE user_account_id = $1',
      [user.userId],
    );
    const accountAfter: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT password_hash, password_change_required, password_changed_at FROM user_account WHERE id = $1',
      [user.userId],
    );
    assert.deepEqual(tokenAfter.rows, tokenBefore.rows);
    assert.deepEqual(accountAfter.rows, accountBefore.rows);
    assert.equal((await get('/auth/session', administratorCookie)).statusCode, 200);
    const anonymousDetails: LightMyRequestResponse = await post(
      '/auth/password-reset/verification',
      { token },
    );
    assert.equal(anonymousDetails.statusCode, 200);
    assert.deepEqual(Object.keys(anonymousDetails.json()), ['expiresAt']);
    const completed: LightMyRequestResponse = await post('/auth/password-reset/complete', {
      token,
      newPassword,
    });
    assert.equal(completed.statusCode, 204);
    assert.match(String(completed.headers['set-cookie']), /Max-Age=0/);
    assert.equal(
      (await post('/auth/login', { email: user.email, password: user.password })).statusCode,
      401,
    );
    assert.equal(
      (await post('/auth/login', { email: user.email, password: newPassword })).statusCode,
      200,
    );
    assert.equal(
      (await post('/auth/password-reset/complete', { token, newPassword })).statusCode,
      400,
    );
  }
});

test('a matching session can reset and is revoked; disabled or deleted targets cannot reset', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'matching-reset@example.test',
  });
  const cookie: string = await loginCookie(user);
  const token: string = await createPasswordResetToken(database.pool, user.userId, false);
  assert.equal(
    (await post('/auth/password-reset/verification', { token }, cookie)).statusCode,
    200,
  );
  assert.equal(
    (await post('/auth/password-reset/complete', { token, newPassword }, cookie)).statusCode,
    204,
  );
  assert.equal((await get('/auth/session', cookie)).statusCode, 401);
  for (const field of ['disabled_at', 'deleted_at'] as const) {
    const inactive: TestUser = await createTestUser(database.pool, {
      email: `reset-${field}@example.test`,
    });
    const inactiveToken: string = await createPasswordResetToken(
      database.pool,
      inactive.userId,
      false,
    );
    await database.pool.query(`UPDATE user_account SET ${field} = now() WHERE id = $1`, [
      inactive.userId,
    ]);
    assert.equal(
      (await post('/auth/password-reset/verification', { token: inactiveToken })).statusCode,
      400,
    );
    assert.equal(
      (await post('/auth/password-reset/complete', { token: inactiveToken, newPassword }))
        .statusCode,
      400,
    );
    const reset: QueryResult<{ consumed_at: Date | null }> = await database.pool.query(
      'SELECT consumed_at FROM password_reset_token WHERE user_account_id = $1',
      [inactive.userId],
    );
    assert.equal(reset.rows[0]?.consumed_at, null);
  }
});

test('registration with a foreign session preserves the pending account until signed-out verification', async (): Promise<void> => {
  const email: string = 'registration-link-isolation@example.test';
  const requested: LightMyRequestResponse = await post('/registration', {
    ...profile,
    email,
    password: administrator.password,
    tenantName: null,
    website: '',
    turnstileToken: '',
  });
  assert.equal(requested.statusCode, 202);
  const token: string = mailToken(email, 'verify-email');
  const pendingBefore: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM pending_registration WHERE email = $1',
    [email],
  );
  const rejected: LightMyRequestResponse = await post(
    '/registration/verify',
    { token },
    administratorCookie,
  );
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json<{ code: string }>().code, 'REGISTRATION_ACCOUNT_MISMATCH');
  const pendingAfter: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM pending_registration WHERE email = $1',
    [email],
  );
  assert.deepEqual(pendingAfter.rows, pendingBefore.rows);
  const accounts: QueryResult<{ count: number }> = await database.pool.query(
    'SELECT count(*)::integer AS count FROM user_account WHERE email = $1',
    [email],
  );
  assert.equal(accounts.rows[0]?.count, 0);
  assert.equal((await post('/registration/verify', { token })).statusCode, 201);
});

test('new instance-user and cookbook-user invitations redact anonymous details and reject foreign sessions without consuming the invitation', async (): Promise<void> => {
  for (const kind of ['instance', 'cookbook'] as const) {
    const email: string = `new-${kind}-link-isolation@example.test`;
    const url: string =
      kind === 'instance'
        ? '/admin/users/invitations'
        : '/cookbook/tenant-users/invitations?tenantSlug=link-guard-kitchen';
    const invited: LightMyRequestResponse = await post(
      url,
      kind === 'instance' ? { email, roleCode: 'user' } : { email, roleId: viewerRoleId },
      administratorCookie,
    );
    assert.equal(invited.statusCode, 201);
    const token: string = mailToken(email, 'user-invitations');
    const details: LightMyRequestResponse = await get(`/user-invitations/${token}`);
    assert.equal(details.statusCode, 200);
    assert.deepEqual(details.json(), {
      email: null,
      existingAccount: false,
      passwordRequired: true,
    });
    const privateDetails: LightMyRequestResponse = await get(
      `/user-invitations/${token}`,
      administratorCookie,
    );
    assert.equal(privateDetails.statusCode, 403);
    assert.deepEqual(Object.keys(privateDetails.json()).sort(), ['code', 'error']);
    const invitationBefore: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT * FROM user_invitation WHERE invited_email = $1',
      [email],
    );
    const rejected: LightMyRequestResponse = await post(
      `/user-invitations/${token}/accept`,
      { ...profile, password: administrator.password },
      administratorCookie,
    );
    assert.equal(rejected.statusCode, 403);
    const invitationAfter: QueryResult<Record<string, unknown>> = await database.pool.query(
      'SELECT * FROM user_invitation WHERE invited_email = $1',
      [email],
    );
    assert.deepEqual(invitationAfter.rows, invitationBefore.rows);
    assert.equal(
      (
        await post(`/user-invitations/${token}/accept`, {
          ...profile,
          password: administrator.password,
        })
      ).statusCode,
      204,
    );
  }
});

test('only the matching existing invitee receives the email address and can accept a cookbook-user invitation', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'private-existing-invitee@example.test',
  });
  const cookie: string = await loginCookie(user);
  assert.equal(
    (
      await post(
        '/cookbook/tenant-users/invitations?tenantSlug=link-guard-kitchen',
        { email: user.email, roleId: viewerRoleId },
        administratorCookie,
      )
    ).statusCode,
    201,
  );
  const token: string = mailToken(user.email, 'user-invitations');
  assert.equal(
    (await get(`/user-invitations/${token}`)).json<{ email: string | null }>().email,
    null,
  );
  assert.equal((await get(`/user-invitations/${token}`, administratorCookie)).statusCode, 403);
  const details: LightMyRequestResponse = await get(`/user-invitations/${token}`, cookie);
  assert.equal(details.statusCode, 200);
  assert.equal(details.json<{ email: string }>().email, user.email);
  assert.equal((await post(`/user-invitations/${token}/accept`, {})).statusCode, 401);
  assert.equal(
    (await post(`/user-invitations/${token}/accept`, {}, administratorCookie)).statusCode,
    403,
  );
  assert.equal((await post(`/user-invitations/${token}/accept`, {}, cookie)).statusCode, 204);
});

test('owner invitations redact account and cookbook details and retain their code after a foreign-session rejection', async (): Promise<void> => {
  const email: string = 'private-owner-link@example.test';
  assert.equal(
    (
      await post(
        '/admin/tenants',
        { email, cookbookName: 'Private Owner Cookbook', slug: 'private-owner-link' },
        administratorCookie,
      )
    ).statusCode,
    201,
  );
  const token: string = mailToken(email, 'invitations');
  const code: string | undefined = mails.get(email)?.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  const details: LightMyRequestResponse = await get(`/invitations/${token}`);
  assert.equal(details.statusCode, 200);
  assert.deepEqual(details.json(), { email: null, cookbookName: null, existingAccount: false });
  const blocked: LightMyRequestResponse = await get(`/invitations/${token}`, administratorCookie);
  assert.equal(blocked.statusCode, 403);
  assert.deepEqual(Object.keys(blocked.json()).sort(), ['code', 'error']);
  assert.equal(
    (await post(`/invitations/${token}/accept`, { ...profile, code }, administratorCookie))
      .statusCode,
    403,
  );
  const codes: QueryResult<{ consumed_at: Date | null }> = await database.pool.query(
    "SELECT consumed_at FROM email_one_time_code WHERE normalized_email = $1 AND purpose = 'TENANT_INVITATION'",
    [email],
  );
  assert.equal(codes.rows[0]?.consumed_at, null);
  assert.equal((await post(`/invitations/${token}/accept`, { ...profile, code })).statusCode, 200);
});
