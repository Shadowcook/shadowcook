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
    email: 'media-admin@example.test',
  });
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [administrator.principalId],
  );
  administratorCookie = await login(administrator);
  ordinaryCookie = await login(
    await createTestUser(database.pool, { email: 'media-reader@example.test' }),
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

test('instance administrators can persist media limits including unlimited and the minimum', async (): Promise<void> => {
  const initial: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/media-settings',
    headers: { cookie: administratorCookie },
  });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), { maxPublishedRecipeImages: 5 });
  assert.equal(initial.headers['cache-control'], 'no-store');
  for (const limit of [0, 1, 9, 2147483647, 5]) {
    const saved: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/admin/media-settings',
      headers: { cookie: administratorCookie },
      payload: { maxPublishedRecipeImages: limit },
    });
    assert.equal(saved.statusCode, 204, saved.body);
    const loaded: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/admin/media-settings',
      headers: { cookie: administratorCookie },
    });
    assert.deepEqual(loaded.json(), { maxPublishedRecipeImages: limit });
  }
});

test('invalid media settings are rejected without replacing the last saved value', async (): Promise<void> => {
  const invalidBodies: unknown[] = [
    {},
    [],
    { maxPublishedRecipeImages: -1 },
    { maxPublishedRecipeImages: 1.5 },
    { maxPublishedRecipeImages: '3' },
    { maxPublishedRecipeImages: null },
    { maxPublishedRecipeImages: 2147483648 },
    { maxPublishedRecipeImages: 3, extra: true },
  ];
  for (const body of invalidBodies) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/admin/media-settings',
      headers: { cookie: administratorCookie, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json<{ code: string }>().code, 'INVALID_MEDIA_SETTINGS');
  }
  const loaded: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/media-settings',
    headers: { cookie: administratorCookie },
  });
  assert.deepEqual(loaded.json(), { maxPublishedRecipeImages: 5 });
});

test('media settings require instance administration for reads and writes', async (): Promise<void> => {
  for (const method of ['GET', 'PUT'] as const) {
    const payload: { maxPublishedRecipeImages: number } | undefined =
      method === 'PUT' ? { maxPublishedRecipeImages: 0 } : undefined;
    assert.equal(
      (await api.inject({ method, url: '/admin/media-settings', payload })).statusCode,
      401,
    );
    assert.equal(
      (
        await api.inject({
          method,
          url: '/admin/media-settings',
          payload,
          headers: { cookie: ordinaryCookie },
        })
      ).statusCode,
      403,
    );
  }
});
