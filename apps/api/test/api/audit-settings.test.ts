import type { QueryResult } from 'pg';
import { pruneAdministrativeAudit } from '../../src/admin/audit-retention.js';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administratorCookie: string;
let ordinaryCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'audit-admin@example.test',
  });
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [administrator.principalId],
  );
  administratorCookie = await login(administrator);
  ordinaryCookie = await login(
    await createTestUser(database.pool, { email: 'audit-reader@example.test' }),
  );
});

after(async (): Promise<void> => {
  if (api) await api.close();
  if (database) await database.close();
});

async function login(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return String(response.headers['set-cookie']);
}

test('instance administrators can persist audit retention including both supported boundaries', async (): Promise<void> => {
  const initial: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/audit-settings',
    headers: { cookie: administratorCookie },
  });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), { retentionDays: 365 });
  assert.equal(initial.headers['cache-control'], 'no-store');
  for (const limit of [1, 3650, 90, 365]) {
    const saved: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/admin/audit-settings',
      headers: { cookie: administratorCookie },
      payload: { retentionDays: limit },
    });
    assert.equal(saved.statusCode, 204, saved.body);
    const loaded: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/admin/audit-settings',
      headers: { cookie: administratorCookie },
    });
    assert.deepEqual(loaded.json(), { retentionDays: limit });
  }
});

test('invalid audit settings are rejected without replacing the last saved value', async (): Promise<void> => {
  const invalidBodies: unknown[] = [
    {},
    [],
    { retentionDays: 0 },
    { retentionDays: -1 },
    { retentionDays: 1.5 },
    { retentionDays: '3' },
    { retentionDays: null },
    { retentionDays: 3651 },
    { retentionDays: 3, extra: true },
  ];
  for (const body of invalidBodies) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/admin/audit-settings',
      headers: { cookie: administratorCookie, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json<{ code: string }>().code, 'INVALID_AUDIT_SETTINGS');
  }
  const loaded: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/audit-settings',
    headers: { cookie: administratorCookie },
  });
  assert.deepEqual(loaded.json(), { retentionDays: 365 });
});

test('audit settings require instance administration for reads and writes', async (): Promise<void> => {
  for (const method of ['GET', 'PUT'] as const) {
    const payload: { retentionDays: number } | undefined =
      method === 'PUT' ? { retentionDays: 0 } : undefined;
    assert.equal(
      (await api.inject({ method, url: '/admin/audit-settings', payload })).statusCode,
      401,
    );
    assert.equal(
      (
        await api.inject({
          method,
          url: '/admin/audit-settings',
          payload,
          headers: { cookie: ordinaryCookie },
        })
      ).statusCode,
      403,
    );
  }
});

test('audit policy endpoints reject Authorization headers even with an administrator session', async (): Promise<void> => {
  for (const method of ['GET', 'PUT'] as const) {
    const response: LightMyRequestResponse = await api.inject({
      method,
      url: '/admin/audit-settings',
      headers: { cookie: administratorCookie, authorization: 'Bearer recipe-token' },
      payload: method === 'PUT' ? { retentionDays: 1 } : undefined,
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json<{ code: string }>().code, 'ADMIN_SESSION_REQUIRED');
  }
});

test('saving a shorter policy leaves events until cleanup, which applies the persisted cutoff', async (): Promise<void> => {
  await database.pool.query(`INSERT INTO administrative_audit_event
    (created_at, actor_principal_id, action, target_type, target_public_id, reason, request_id, outcome)
    VALUES (now() - interval '2 days', gen_random_uuid(), 'ADMIN_TEST', 'INSTANCE', gen_random_uuid(), 'Retention test', 'old', 'SUCCEEDED'),
      (now(), gen_random_uuid(), 'ADMIN_TEST', 'INSTANCE', gen_random_uuid(), 'Retention test', 'recent', 'SUCCEEDED')`);
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: '/admin/audit-settings',
    headers: { cookie: administratorCookie },
    payload: { retentionDays: 1 },
  });
  assert.equal(saved.statusCode, 204, saved.body);
  assert.equal((await database.pool.query('SELECT * FROM administrative_audit_event')).rowCount, 2);
  assert.equal(await pruneAdministrativeAudit(database.pool), 1);
  const retained: QueryResult<{ request_id: string }> = await database.pool.query(
    'SELECT request_id FROM administrative_audit_event',
  );
  assert.deepEqual(retained.rows, [{ request_id: 'recent' }]);
});
