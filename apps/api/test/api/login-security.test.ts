import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { cleanupExpiredPasswordLoginFailures } from '../../src/auth/password-login.js';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
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

test('failed password logins count by IP across accounts and never lock the targeted account', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, { email: 'ip-limit@example.test' });
  const attackerIp: string = '198.51.100.1';
  for (let attempt: number = 0; attempt < 10; attempt += 1) {
    const response: LightMyRequestResponse = await passwordLogin(
      attackerIp,
      attempt % 2 === 0 ? user.email : 'unknown@example.test',
      'wrong-password',
    );
    assert.equal(response.statusCode, 401);
    assert.equal(response.json<{ code: string }>().code, 'INVALID_CREDENTIALS');
  }
  const blocked: LightMyRequestResponse = await passwordLogin(
    attackerIp,
    user.email,
    user.password,
  );
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json<{ code: string }>().code, 'LOGIN_RATE_LIMITED');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.ok(Number(blocked.headers['retry-after']) <= 900);
  assert.equal(blocked.headers['set-cookie'], undefined);
  assert.equal((await passwordLogin('198.51.100.2', user.email, user.password)).statusCode, 200);
  assert.equal(await failureCount(attackerIp), 10);
});

test('successful and malformed requests do not count as failures or clear earlier failures', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'success-count@example.test',
  });
  const ip: string = '198.51.100.3';
  await seedFailures(ip, 9, '1 minute');
  for (let attempt: number = 0; attempt < 3; attempt += 1)
    assert.equal((await passwordLogin(ip, user.email, user.password)).statusCode, 200);
  const malformed: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: ip,
    payload: { email: user.email },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(await failureCount(ip), 9);
  assert.equal((await passwordLogin(ip, user.email, 'wrong-password')).statusCode, 401);
  assert.equal((await passwordLogin(ip, user.email, user.password)).statusCode, 429);
});

test('blocked retries do not extend the window and expired failures allow login again', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, { email: 'window@example.test' });
  const ip: string = '198.51.100.4';
  await seedFailures(ip, 10, '14 minutes');
  const blocked: LightMyRequestResponse = await passwordLogin(ip, user.email, user.password);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['retry-after']) <= 60);
  assert.equal(await failureCount(ip), 10);
  await database.pool.query(
    "UPDATE password_login_failure SET created_at = clock_timestamp() - interval '16 minutes' WHERE client_ip = $1::inet",
    [ip],
  );
  assert.equal((await passwordLogin(ip, user.email, user.password)).statusCode, 200);
  await cleanupExpiredPasswordLoginFailures(database.pool);
  assert.equal(await failureCount(ip), 0);
});

test('simultaneous failures share an atomic limit and equivalent IPv6 addresses share a bucket', async (): Promise<void> => {
  const addresses: string[] = ['2001:db8::1', '2001:0db8:0:0:0:0:0:1'];
  const responses: LightMyRequestResponse[] = await Promise.all(
    Array.from(
      { length: 12 },
      (_value: unknown, attempt: number): Promise<LightMyRequestResponse> =>
        passwordLogin(addresses[attempt % 2]!, `unknown-${attempt}@example.test`, 'wrong-password'),
    ),
  );
  assert.equal(
    responses.filter((response: LightMyRequestResponse): boolean => response.statusCode === 401)
      .length,
    10,
  );
  assert.equal(
    responses.filter((response: LightMyRequestResponse): boolean => response.statusCode === 429)
      .length,
    2,
  );
  assert.equal(await failureCount(addresses[0]!), 10);
});

test('forwarded IPs are ignored for untrusted peers and resolved from the right for trusted peers', async (): Promise<void> => {
  const direct: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: '198.51.100.5',
    headers: { 'x-forwarded-for': '203.0.113.1' },
    payload: { email: 'unknown@example.test', password: 'wrong-password' },
  });
  assert.equal(direct.statusCode, 401);
  assert.equal(await failureCount('198.51.100.5'), 1);
  assert.equal(await failureCount('203.0.113.1'), 0);

  const proxiedApi: FastifyInstance = createTestApi(database.pool, ['127.0.0.1']);
  try {
    const proxied: LightMyRequestResponse = await proxiedApi.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.6' },
      payload: { email: 'unknown@example.test', password: 'wrong-password' },
    });
    assert.equal(proxied.statusCode, 401);
    assert.equal(await failureCount('198.51.100.6'), 1);
    assert.equal(await failureCount('203.0.113.1'), 0);
  } finally {
    await proxiedApi.close();
  }
});

test('password changes revoke other account sessions, retain the current session and preserve other accounts', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'change-sessions@example.test',
  });
  const other: TestUser = await createTestUser(database.pool, {
    email: 'other-sessions@example.test',
  });
  const currentCookie: string = await loginCookie(user);
  const oldCookie: string = await loginCookie(user);
  const otherCookie: string = await loginCookie(other);
  const newPassword: string = 'bL8@fW3!rV9#jC2$mQ7%aX5&zN4*';
  const changed: LightMyRequestResponse = await changeUserPassword(
    currentCookie,
    user.password,
    newPassword,
  );
  assert.equal(changed.statusCode, 204);
  assert.equal((await readSession(currentCookie)).statusCode, 200);
  assert.equal((await readSession(oldCookie)).statusCode, 401);
  assert.equal((await readSession(otherCookie)).statusCode, 200);
  assert.equal((await passwordLogin('198.51.100.7', user.email, user.password)).statusCode, 401);
  assert.equal((await passwordLogin('198.51.100.7', user.email, newPassword)).statusCode, 200);
});

test('rejected password changes leave the password and all sessions unchanged', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'rejected-change@example.test',
  });
  const currentCookie: string = await loginCookie(user);
  const otherCookie: string = await loginCookie(user);
  assert.equal(
    (await changeUserPassword(currentCookie, 'wrong-password', user.password)).statusCode,
    401,
  );
  assert.equal((await changeUserPassword(currentCookie, user.password, 'weak')).statusCode, 400);
  assert.equal((await readSession(currentCookie)).statusCode, 200);
  assert.equal((await readSession(otherCookie)).statusCode, 200);
  assert.equal((await passwordLogin('198.51.100.8', user.email, user.password)).statusCode, 200);
});

test('concurrent password changes recheck the current password under the account lock', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'concurrent-change@example.test',
  });
  const cookie: string = await loginCookie(user);
  const responses: LightMyRequestResponse[] = await Promise.all([
    changeUserPassword(cookie, user.password, 'bL8@fW3!rV9#jC2$mQ7%aX5&zN4*'),
    changeUserPassword(cookie, user.password, 'gT9#mR4!wJ8@vL2$zQ6%cX3&kN5*'),
  ]);
  assert.deepEqual(
    responses.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [204, 401],
  );
  assert.equal((await readSession(cookie)).statusCode, 200);
});

async function passwordLogin(
  ip: string,
  email: string,
  password: string,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: ip,
    payload: { email, password },
  });
}

async function failureCount(ip: string): Promise<number> {
  const result: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM password_login_failure WHERE client_ip = $1::inet',
    [ip],
  );
  return result.rows[0]!.count;
}

async function seedFailures(ip: string, count: number, age: string): Promise<void> {
  await database.pool.query(
    'INSERT INTO password_login_failure (client_ip, created_at) SELECT $1::inet, clock_timestamp() - $3::interval FROM generate_series(1, $2::integer)',
    [ip, count, age],
  );
}

async function loginCookie(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await passwordLogin(
    '198.51.100.9',
    user.email,
    user.password,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.headers['set-cookie'], 'string');
  return response.headers['set-cookie'] as string;
}

async function changeUserPassword(
  cookie: string,
  currentPassword: string,
  newPassword: string,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/auth/change-password',
    headers: { cookie },
    payload: { currentPassword, newPassword },
  });
}

async function readSession(cookie: string): Promise<LightMyRequestResponse> {
  return api.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
}
