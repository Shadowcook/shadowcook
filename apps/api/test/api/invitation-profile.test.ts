import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import type { AccountProfile } from '../../src/account/profile.js';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

type LoginMode = 'PASSWORD_ONLY' | 'EMAIL_CODE_ONLY' | 'PASSWORD_OR_EMAIL_CODE';
type UserInvitationPath = 'INSTANCE' | 'COOKBOOK';
interface StoredProfile extends AccountProfile {
  principalId: string;
  passwordHash: string | null;
}
interface UserInvitationDetails {
  email: string | null;
  passwordRequired: boolean;
  existingAccount: boolean;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administrator: TestUser;
let administratorCookie: string;
let owner: TestUser;
let ownerCookie: string;
let editorRoleId: string;
let viewerRoleId: string;
const mails: Map<string, string> = new Map<string, string>();
const profile: AccountProfile = {
  firstName: 'Zoë',
  lastName: "O'Neill",
  displayName: 'Recipe Star',
};
const submittedProfile: AccountProfile = {
  firstName: ` ${profile.firstName} `,
  lastName: ` ${profile.lastName} `,
  displayName: ` ${profile.displayName} `,
};

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  administrator = await createTestUser(database.pool, { email: 'invitation-admin@example.test' });
  owner = await createTestUser(database.pool, { email: 'invitation-owner@example.test' });
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [administrator.principalId],
  );
  administratorCookie = await loginCookie(administrator);
  ownerCookie = await loginCookie(owner);
  const cookbook: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: ownerCookie },
    payload: { cookbookName: 'Invitation Kitchen' },
  });
  assert.equal(cookbook.statusCode, 201);
  const roles: QueryResult<{ id: string; name: string }> = await database.pool.query(
    "SELECT role.id, role.name FROM tenant_role AS role INNER JOIN tenant ON tenant.id = role.tenant_id WHERE tenant.slug = 'invitation-kitchen'",
  );
  editorRoleId = roles.rows.find(
    (role: { id: string; name: string }): boolean => role.name === 'Editor',
  )!.id;
  viewerRoleId = roles.rows.find(
    (role: { id: string; name: string }): boolean => role.name === 'Viewer',
  )!.id;
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

for (const path of ['INSTANCE', 'COOKBOOK'] as const) {
  for (const mode of ['PASSWORD_ONLY', 'EMAIL_CODE_ONLY', 'PASSWORD_OR_EMAIL_CODE'] as const) {
    test(`${path} invitation collects and stores the invitee's profile in ${mode}`, async (): Promise<void> => {
      await setLoginMode(mode);
      const email: string = `${path.toLowerCase()}-${mode.toLowerCase()}@example.test`;
      const token: string = await inviteUser(
        path,
        email,
        mode === 'EMAIL_CODE_ONLY' ? viewerRoleId : editorRoleId,
      );
      const details: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url: `/user-invitations/${token}`,
      });
      assert.deepEqual(details.json<UserInvitationDetails>(), {
        email: null,
        existingAccount: false,
        passwordRequired: mode !== 'EMAIL_CODE_ONLY',
      });
      const password: string | undefined = mode === 'EMAIL_CODE_ONLY' ? undefined : owner.password;
      await assertInvalidProfile(`/user-invitations/${token}/accept`, { password });
      if (password !== undefined) {
        const missingPassword: LightMyRequestResponse = await api.inject({
          method: 'POST',
          url: `/user-invitations/${token}/accept`,
          payload: submittedProfile,
        });
        assert.equal(missingPassword.statusCode, 400);
        assert.equal(missingPassword.json<{ code: string }>().code, 'INVALID_PASSWORD');
      }
      const accepted: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: `/user-invitations/${token}/accept`,
        payload: { ...submittedProfile, password },
      });
      assert.equal(accepted.statusCode, 204);
      const account: StoredProfile = await storedProfile(email);
      assertStoredNames(account);
      assert.equal(account.passwordHash === null, mode === 'EMAIL_CODE_ONLY');
      if (path === 'COOKBOOK') {
        const membership: QueryResult<{ role_id: string }> = await database.pool.query(
          'SELECT tenant_role_id AS role_id FROM tenant_membership_role WHERE principal_id = $1',
          [account.principalId],
        );
        assert.deepEqual(membership.rows, [
          { role_id: mode === 'EMAIL_CODE_ONLY' ? viewerRoleId : editorRoleId },
        ]);
      } else {
        const role: QueryResult<{ code: string }> = await database.pool.query(
          'SELECT role.code FROM principal_instance_role AS assignment INNER JOIN instance_role AS role ON role.id = assignment.instance_role_id WHERE assignment.principal_id = $1',
          [account.principalId],
        );
        assert.deepEqual(role.rows, [{ code: 'user' }]);
      }
      const reused: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: `/user-invitations/${token}/accept`,
        payload: { ...submittedProfile, password },
      });
      assert.equal(reused.statusCode, 404);
    });
  }
}

test('a cookbook owner without instance administration can invite an existing account without changing its profile', async (): Promise<void> => {
  await setLoginMode('PASSWORD_OR_EMAIL_CODE');
  const forbidden: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { cookie: ownerCookie },
  });
  assert.equal(forbidden.statusCode, 403);
  const existing: TestUser = await createTestUser(database.pool, {
    email: 'existing-invitee@example.test',
  });
  await setProfile(existing);
  const cookie: string = await loginCookie(existing);
  const token: string = await inviteUser('COOKBOOK', existing.email, viewerRoleId);
  const details: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/user-invitations/${token}`,
  });
  assert.equal(details.json<UserInvitationDetails>().existingAccount, true);
  const anonymous: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/user-invitations/${token}/accept`,
    payload: {},
  });
  assert.equal(anonymous.statusCode, 401);
  const mismatch: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/user-invitations/${token}/accept`,
    headers: { cookie: ownerCookie },
    payload: {},
  });
  assert.equal(mismatch.statusCode, 403);
  const accepted: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/user-invitations/${token}/accept`,
    headers: { cookie },
    payload: {},
  });
  assert.equal(accepted.statusCode, 204);
  assertStoredNames(await storedProfile(existing.email));
});

test('cookbook-owner invitations are sent by email only and new owners complete all three names', async (): Promise<void> => {
  await setLoginMode('PASSWORD_OR_EMAIL_CODE');
  const email: string = 'new-cookbook-owner@example.test';
  const token: string = await inviteOwner(email, 'new-owner-kitchen');
  const invitation: QueryResult<{ first_name: string | null; last_name: string | null }> =
    await database.pool.query(
      'SELECT first_name, last_name FROM tenant_invitation WHERE invited_email = $1',
      [email],
    );
  assert.deepEqual(invitation.rows[0], { first_name: null, last_name: null });
  const details: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/invitations/${token}`,
  });
  assert.deepEqual(details.json(), {
    email: null,
    cookbookName: null,
    existingAccount: false,
  });
  const code: string = mailCode(email);
  await assertInvalidProfile(`/invitations/${token}/accept`, { code });
  const consumed: QueryResult<{ consumed_at: Date | null }> = await database.pool.query(
    "SELECT consumed_at FROM email_one_time_code WHERE normalized_email = $1 AND purpose = 'TENANT_INVITATION'",
    [email],
  );
  assert.equal(consumed.rows[0]?.consumed_at, null);
  const accepted: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/invitations/${token}/accept`,
    payload: { ...submittedProfile, code },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), {
    cookbookSlug: 'new-owner-kitchen',
    hasPassword: false,
    passwordChangeRequired: true,
  });
  const account: StoredProfile = await storedProfile(email);
  assertStoredNames(account);
  const tenant: QueryResult<{ owner_principal_id: string }> = await database.pool.query(
    "SELECT owner_principal_id FROM tenant WHERE slug = 'new-owner-kitchen'",
  );
  assert.equal(tenant.rows[0]?.owner_principal_id, account.principalId);
  const membership: QueryResult<{ name: string }> = await database.pool.query(
    'SELECT role.name FROM tenant_membership_role AS assignment INNER JOIN tenant_role AS role ON role.id = assignment.tenant_role_id WHERE assignment.principal_id = $1',
    [account.principalId],
  );
  assert.deepEqual(membership.rows, [{ name: 'Owner' }]);
});

test('existing accounts accept cookbook-owner invitations with only the email code and retain their profile', async (): Promise<void> => {
  const existing: TestUser = await createTestUser(database.pool, {
    email: 'existing-cookbook-owner@example.test',
  });
  await setProfile(existing);
  const token: string = await inviteOwner(existing.email, 'existing-owner-kitchen');
  const details: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/invitations/${token}`,
  });
  assert.equal(details.json<{ existingAccount: boolean }>().existingAccount, true);
  const code: string = mailCode(existing.email);
  const mismatch: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/invitations/${token}/accept`,
    headers: { cookie: ownerCookie },
    payload: { code },
  });
  assert.equal(mismatch.statusCode, 403);
  const accepted: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/invitations/${token}/accept`,
    payload: { code },
  });
  assert.equal(accepted.statusCode, 200);
  assertStoredNames(await storedProfile(existing.email));
});

async function assertInvalidProfile(url: string, extra: object): Promise<void> {
  for (const field of ['firstName', 'lastName', 'displayName']) {
    for (const value of [undefined, null, 42, '', ' \t ', 'x'.repeat(121)]) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url,
        payload: { ...profile, [field]: value, ...extra },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json<{ code: string }>().code, 'INVALID_ACCOUNT_PROFILE');
    }
  }
}

async function setLoginMode(mode: LoginMode): Promise<void> {
  await database.pool.query(
    'INSERT INTO instance_authentication_settings (login_mode) VALUES ($1) ON CONFLICT (singleton) DO UPDATE SET login_mode = EXCLUDED.login_mode',
    [mode],
  );
}

async function inviteUser(
  path: UserInvitationPath,
  email: string,
  roleId: string,
): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url:
      path === 'INSTANCE'
        ? '/admin/users/invitations'
        : '/cookbook/tenant-users/invitations?tenantSlug=invitation-kitchen',
    headers: { cookie: path === 'INSTANCE' ? administratorCookie : ownerCookie },
    payload: path === 'INSTANCE' ? { email, roleCode: 'user' } : { email, roleId },
  });
  assert.equal(response.statusCode, 201);
  return mailToken(email, 'user-invitations');
}

async function inviteOwner(email: string, slug: string): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/admin/tenants',
    headers: { cookie: administratorCookie },
    payload: { email, cookbookName: 'Owner Kitchen', slug },
  });
  assert.equal(response.statusCode, 201);
  return mailToken(email, 'invitations');
}

function mailToken(email: string, path: string): string {
  const token: string | undefined = mails
    .get(email)
    ?.match(new RegExp(`/${path}/([A-Za-z0-9_-]+)`))?.[1];
  assert.ok(token);
  return token;
}

function mailCode(email: string): string {
  const code: string | undefined = mails.get(email)?.match(/\b[0-9]{6}\b/)?.[0];
  assert.ok(code);
  return code;
}

async function loginCookie(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200);
  const cookie: string | string[] | undefined = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return cookie as string;
}

async function setProfile(user: TestUser): Promise<void> {
  await database.pool.query(
    'UPDATE user_account SET first_name = $1, last_name = $2, display_name = $3 WHERE id = $4',
    [profile.firstName, profile.lastName, profile.displayName, user.userId],
  );
}

async function storedProfile(email: string): Promise<StoredProfile> {
  const result: QueryResult<StoredProfile> = await database.pool.query(
    `SELECT first_name AS "firstName", last_name AS "lastName", display_name AS "displayName",
     principal_id AS "principalId", password_hash AS "passwordHash" FROM user_account WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

function assertStoredNames(account: StoredProfile): void {
  assert.equal(account.firstName, profile.firstName);
  assert.equal(account.lastName, profile.lastName);
  assert.equal(account.displayName, profile.displayName);
}
