import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test, type TestContext } from 'node:test';
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

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
const profile: AccountProfile = {
  firstName: 'Émilie',
  lastName: "O'Connor-Smith",
  displayName: 'Kitchen Star',
};

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'profile-mail-admin@example.test',
  });
  await database.pool.query(
    `INSERT INTO instance_mail_settings
     (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id)
     VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)`,
    [administrator.principalId],
  );
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('profile endpoints require a session', async (): Promise<void> => {
  for (const method of ['GET', 'PUT'] as const) {
    const response: LightMyRequestResponse = await api.inject({
      method,
      url: '/account/profile',
      ...(method === 'PUT' ? { payload: profile } : {}),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json<{ code: string }>().code, 'AUTHENTICATION_REQUIRED');
  }
});

test('existing accounts can fill and repeatedly edit their own names without changing other accounts', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, { email: 'profile@example.test' });
  const other: TestUser = await createTestUser(database.pool, {
    email: 'other-profile@example.test',
  });
  const cookie: string = await loginCookie(user);
  const initial: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/profile',
    headers: { cookie },
  });
  assert.deepEqual(initial.json(), { firstName: null, lastName: null, displayName: 'Test user' });

  for (const displayName of ['Kitchen Star', 'New display name']) {
    const expected: AccountProfile = { ...profile, displayName };
    const updated: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/account/profile',
      headers: { cookie },
      payload: {
        firstName: `  ${profile.firstName}  `,
        lastName: ` ${profile.lastName} `,
        displayName: ` ${displayName} `,
        userId: other.userId,
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json(), expected);
    const retrieved: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/account/profile',
      headers: { cookie },
    });
    assert.deepEqual(retrieved.json(), expected);
    const session: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie },
    });
    assert.equal(session.json<{ displayName: string }>().displayName, displayName);
  }
  const untouched: QueryResult<{
    first_name: string | null;
    last_name: string | null;
    display_name: string;
  }> = await database.pool.query(
    'SELECT first_name, last_name, display_name FROM user_account WHERE id = $1',
    [other.userId],
  );
  assert.deepEqual(untouched.rows[0], {
    first_name: null,
    last_name: null,
    display_name: 'Test user',
  });
});

test('registration and profile updates reject missing, blank, non-string, and oversized names', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'invalid-profile@example.test',
  });
  const cookie: string = await loginCookie(user);
  for (const field of ['firstName', 'lastName', 'displayName']) {
    for (const value of [undefined, null, 7, '', ' \t\n ', 'x'.repeat(121)]) {
      const invalid: Record<string, unknown> = { ...profile, [field]: value };
      const update: LightMyRequestResponse = await api.inject({
        method: 'PUT',
        url: '/account/profile',
        headers: { cookie },
        payload: invalid,
      });
      assert.equal(update.statusCode, 400);
      assert.equal(update.json<{ code: string }>().code, 'INVALID_ACCOUNT_PROFILE');
      const registration: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: '/registration',
        payload: {
          ...invalid,
          email: 'invalid-registration@example.test',
          password: user.password,
          tenantName: null,
          turnstileToken: '',
          website: '',
        },
      });
      assert.equal(registration.statusCode, 400);
      assert.equal(registration.json<{ code: string }>().code, 'INVALID_REGISTRATION');
    }
  }
});

test('registration retains names through replacement and email verification with or without a cookbook', async (context: TestContext): Promise<void> => {
  let mailText: string = '';
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: { text: string }): Promise<void> => {
      mailText = mail.text;
    },
  }));
  for (const tenantName of [null, 'Profile Cookbook']) {
    const email: string =
      tenantName === null ? 'registration-profile@example.test' : 'cookbook-profile@example.test';
    const user: TestUser = await createTestUser(database.pool, { email: `password-${email}` });
    for (const displayName of ['Original display name', profile.displayName]) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: '/registration',
        payload: {
          firstName: ` ${profile.firstName} `,
          lastName: ` ${profile.lastName} `,
          displayName,
          email,
          password: user.password,
          tenantName,
          turnstileToken: '',
          website: '',
        },
      });
      assert.equal(response.statusCode, 202);
    }
    const pending: QueryResult<{ first_name: string; last_name: string; display_name: string }> =
      await database.pool.query(
        'SELECT first_name, last_name, display_name FROM pending_registration WHERE email = $1',
        [email],
      );
    assert.deepEqual(pending.rows[0], {
      first_name: profile.firstName,
      last_name: profile.lastName,
      display_name: profile.displayName,
    });
    const beforeVerification: QueryResult<{ count: number }> = await database.pool.query(
      'SELECT count(*)::integer AS count FROM user_account WHERE email = $1',
      [email],
    );
    assert.equal(beforeVerification.rows[0]?.count, 0);
    const token: string | undefined = mailText.match(/\/verify-email\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token);
    const verification: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/registration/verify',
      payload: { token },
    });
    assert.equal(verification.statusCode, 201);
    assert.deepEqual(verification.json(), {
      tenantSlug: tenantName === null ? null : 'profile-cookbook',
    });
    const account: QueryResult<{ first_name: string; last_name: string; display_name: string }> =
      await database.pool.query(
        'SELECT first_name, last_name, display_name FROM user_account WHERE email = $1',
        [email],
      );
    assert.deepEqual(account.rows, pending.rows);
    const remaining: QueryResult<{ count: number }> = await database.pool.query(
      'SELECT count(*)::integer AS count FROM pending_registration WHERE email = $1',
      [email],
    );
    assert.equal(remaining.rows[0]?.count, 0);
    const reused: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/registration/verify',
      payload: { token },
    });
    assert.equal(reused.statusCode, 400);
  }
});

test('pending registrations created before the name migration still verify', async (): Promise<void> => {
  const token: string = 'legacy-registration-token';
  await database.pool.query(
    `INSERT INTO pending_registration (email, password_hash, tenant_name, verification_token_hash, expires_at)
     VALUES ('legacy-profile@example.test', 'legacy-hash', NULL, $1, now() + interval '1 hour')`,
    [createHash('sha256').update(token).digest()],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/registration/verify',
    payload: { token },
  });
  assert.equal(response.statusCode, 201);
  const account: QueryResult<{
    first_name: string | null;
    last_name: string | null;
    display_name: string;
  }> = await database.pool.query(
    "SELECT first_name, last_name, display_name FROM user_account WHERE email = 'legacy-profile@example.test'",
  );
  assert.deepEqual(account.rows[0], {
    first_name: null,
    last_name: null,
    display_name: 'legacy-profile',
  });
});

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
