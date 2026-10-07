import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { hashSessionToken } from '../../src/auth/session.js';
import { createTestApi } from '../helpers/api.js';
import { assignTenantRole, createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('login rejects malformed and invalid credentials with documented error codes', async (): Promise<void> => {
  const malformedResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'owner@example.test' },
  });
  const invalidResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'unknown@example.test', password: 'not-the-password' },
  });

  assert.equal(malformedResponse.statusCode, 400);
  assert.deepEqual(malformedResponse.json(), {
    code: 'INVALID_LOGIN_BODY',
    error: 'Email and password are required.',
  });
  assert.equal(invalidResponse.statusCode, 401);
  assert.deepEqual(invalidResponse.json(), {
    code: 'INVALID_CREDENTIALS',
    error: 'Invalid email or password.',
  });
});

test('login creates an HttpOnly session and logout revokes it', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'session@example.test',
  });
  const loginResponse = await login(user);
  const cookie: string = sessionCookie(loginResponse.headers['set-cookie']);

  assert.equal(loginResponse.statusCode, 200);
  assert.match(cookie, /^shadowcook_session=[A-Za-z0-9_-]+;/);
  assert.match(cookie, /; HttpOnly;/);
  assert.match(cookie, /; SameSite=Lax;/);
  assert.doesNotMatch(cookie, /; Secure(?:;|$)/);

  const sessionResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });
  assert.equal(sessionResponse.statusCode, 200);
  assert.deepEqual(sessionResponse.json(), {
    email: user.email,
    passwordChangeRequired: false,
    hasPassword: true,
  });

  const logoutResponse = await api.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { cookie },
  });
  assert.equal(logoutResponse.statusCode, 204);
  assert.match(String(logoutResponse.headers['set-cookie']), /Max-Age=0/);

  const revokedResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });
  assertAuthenticationRequired(revokedResponse.statusCode, revokedResponse.json());
});

test('disabled users cannot create sessions', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'disabled@example.test',
    disabled: true,
  });
  const response = await login(user);

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), {
    code: 'INVALID_CREDENTIALS',
    error: 'Invalid email or password.',
  });
});

test('deactivating a user invalidates an existing session', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'deactivated-session@example.test',
  });
  const loginResponse = await login(user);
  const cookie: string = sessionCookie(loginResponse.headers['set-cookie']);
  await database.pool.query('UPDATE user_account SET disabled_at = now() WHERE id = $1', [
    user.userId,
  ]);

  const response = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });

  assertAuthenticationRequired(response.statusCode, response.json());
});

test('missing, malformed, expired, and revoked session credentials are rejected', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'credentials@example.test',
  });
  const token: string = 'expired-session-token';
  await database.pool.query(
    `INSERT INTO user_session (user_account_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, now() - interval '2 minutes', now() - interval '1 minute')`,
    [user.userId, hashSessionToken(token)],
  );

  const responses = await Promise.all([
    api.inject({ method: 'GET', url: '/auth/session' }),
    api.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: 'shadowcook_session=malformed' },
    }),
    api.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `shadowcook_session=${token}` },
    }),
  ]);
  for (const response of responses) {
    assertAuthenticationRequired(response.statusCode, response.json());
  }
});

test('password-change-required sessions can reach only authentication endpoints', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'password-change@example.test',
    passwordChangeRequired: true,
  });
  const loginResponse = await login(user);
  const cookie: string = sessionCookie(loginResponse.headers['set-cookie']);

  const sessionResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });
  const protectedResponse = await api.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { cookie },
  });

  assert.equal(sessionResponse.statusCode, 200);
  assert.equal(protectedResponse.statusCode, 403);
  assert.deepEqual(protectedResponse.json(), {
    code: 'PASSWORD_CHANGE_REQUIRED',
    error: 'A password change is required before continuing.',
  });
});

test('a tenant role never grants instance administration', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'tenant-owner@example.test',
  });
  await assignTenantRole(database.pool, user.principalId, 'alpha');
  const loginResponse = await login(user);
  const cookie: string = sessionCookie(loginResponse.headers['set-cookie']);

  const anonymousResponse = await api.inject({ method: 'GET', url: '/admin/tenants' });
  const tenantOwnerResponse = await api.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { cookie },
  });

  assertAuthenticationRequired(anonymousResponse.statusCode, anonymousResponse.json());
  assert.equal(tenantOwnerResponse.statusCode, 403);
  assert.deepEqual(tenantOwnerResponse.json(), {
    code: 'INSTANCE_PERMISSION_REQUIRED',
    error: 'An instance permission is required.',
  });
});

async function login(user: TestUser) {
  return await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
}

function sessionCookie(header: string | string[] | undefined): string {
  if (typeof header !== 'string') throw new Error('Login response did not set a session cookie.');
  return header;
}

function assertAuthenticationRequired(statusCode: number, body: unknown): void {
  assert.equal(statusCode, 401);
  assert.deepEqual(body, {
    code: 'AUTHENTICATION_REQUIRED',
    error: 'Authentication is required.',
  });
}
