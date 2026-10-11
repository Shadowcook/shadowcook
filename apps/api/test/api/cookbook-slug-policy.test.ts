import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administratorCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'slug-administrator@example.test',
  });
  await database.pool.query(
    `INSERT INTO principal_instance_role (principal_id, instance_role_id)
     SELECT $1, id FROM instance_role WHERE code = 'administrator'`,
    [administrator.principalId],
  );
  const response = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: administrator.email, password: administrator.password },
  });
  administratorCookie = String(response.headers['set-cookie']);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('blocked terms apply to cookbook URL previews and are administered by instance administrators', async (): Promise<void> => {
  const create = await api.inject({
    method: 'POST',
    url: '/admin/cookbook-slug-blocked-terms',
    headers: { cookie: administratorCookie },
    payload: { term: 'adult' },
  });
  const preview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=My%20Adult%20Kitchen',
  });
  const list = await api.inject({
    method: 'GET',
    url: '/admin/cookbook-slug-blocked-terms',
    headers: { cookie: administratorCookie },
  });
  const remove = await api.inject({
    method: 'DELETE',
    url: '/admin/cookbook-slug-blocked-terms/adult',
    headers: { cookie: administratorCookie },
  });

  assert.equal(create.statusCode, 201);
  assert.deepEqual(create.json(), { term: 'adult' });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json(), { slug: 'my-adult-kitchen', available: false });
  assert.deepEqual(list.json(), { terms: ['adult'] });
  assert.equal(remove.statusCode, 204);
});

test('hardcoded reserved cookbook URL namespaces are unavailable', async (): Promise<void> => {
  const preview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=Admin',
  });

  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json(), { slug: 'admin', available: false });
});

test('cookbook names are trimmed and require an alphanumeric start and three alphanumeric characters', async (): Promise<void> => {
  const invalidPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=-abc',
  });
  const insufficientPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=a--b',
  });
  const trimmedPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=%20%20Ab-c%20%20',
  });

  assert.equal(invalidPreview.statusCode, 400);
  assert.equal(insufficientPreview.statusCode, 400);
  assert.equal(trimmedPreview.statusCode, 200);
  assert.deepEqual(trimmedPreview.json(), { slug: 'ab-c', available: true });
});

test('account cookbook creation rejects a slug containing a blocked term', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'blocked-cookbook-owner@example.test',
  });
  await database.pool.query(
    `INSERT INTO instance_cookbook_slug_blocked_term (term, created_by_principal_id)
     VALUES ('restricted', NULL)`,
  );
  const login = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  const response = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: String(login.headers['set-cookie']) },
    payload: { cookbookName: 'Restricted dishes' },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    code: 'COOKBOOK_SLUG_BLOCKED',
    error: 'The cookbook slug is unavailable.',
  });
});
