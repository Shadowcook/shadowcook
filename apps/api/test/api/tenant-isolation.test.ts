import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestTenant,
  createTestUser,
  type TestCategory,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
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

test('a tenant principal cannot read or mutate categories in another tenant', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, { email: 'alpha-owner@example.test' });
  const alpha: TestTenant = await assignTenantRole(database.pool, user.principalId, 'alpha', [
    'category:update',
  ]);
  const bravo: TestTenant = await createTestTenant(database.pool, 'bravo');
  const bravoCategory: TestCategory = await createTestCategory(
    database.pool,
    bravo.id,
    'Bravo private category',
    'bravo-private-category',
  );
  const cookie: string = await loginCookie(user);

  const alphaCategoryResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${alpha.slug}/categories`,
    headers: { cookie },
    payload: { name: 'Alpha category', slug: 'alpha-category', parentPublicId: null },
  });
  const alphaListResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/tenants/${alpha.slug}/categories`,
    headers: { cookie },
  });
  const bravoListResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/tenants/${bravo.slug}/categories`,
    headers: { cookie },
  });
  const bravoCreateResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${bravo.slug}/categories`,
    headers: { cookie },
    payload: { name: 'Forbidden category', slug: 'forbidden-category', parentPublicId: null },
  });
  const crossTenantPublicIdResponse = await api.inject({
    method: 'PATCH',
    url: `/cookbook/tenants/${alpha.slug}/categories/${bravoCategory.publicId}`,
    headers: { cookie },
    payload: { name: 'Changed', slug: 'changed', parentPublicId: null },
  });

  assert.equal(alphaCategoryResponse.statusCode, 201);
  assert.equal(alphaListResponse.statusCode, 200);
  assert.deepEqual(alphaListResponse.json(), {
    categories: [
      {
        publicId: alphaCategoryResponse.json().publicId,
        parentPublicId: null,
        name: 'Alpha category',
        slug: 'alpha-category',
        sortOrder: 0,
        canDelete: true,
      },
    ],
  });
  assert.equal(bravoListResponse.statusCode, 403);
  assert.deepEqual(bravoListResponse.json(), {
    code: 'TENANT_PERMISSION_REQUIRED',
    error: 'A tenant permission is required.',
  });
  assert.equal(bravoCreateResponse.statusCode, 403);
  assert.deepEqual(bravoCreateResponse.json(), {
    code: 'TENANT_PERMISSION_REQUIRED',
    error: 'A tenant permission is required.',
  });
  assert.equal(crossTenantPublicIdResponse.statusCode, 404);
  assert.deepEqual(crossTenantPublicIdResponse.json(), {
    code: 'CATEGORY_NOT_FOUND',
    error: 'The category was not found.',
  });

  const bravoCategories = await database.pool.query<{ slug: string }>(
    'SELECT slug FROM category WHERE tenant_id = $1 ORDER BY slug',
    [bravo.id],
  );
  assert.deepEqual(bravoCategories.rows, [{ slug: 'bravo-private-category' }]);
});

async function loginCookie(user: TestUser): Promise<string> {
  const response = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  const header: string | string[] | undefined = response.headers['set-cookie'];
  if (response.statusCode !== 200 || typeof header !== 'string') {
    throw new Error('Test fixture user could not create a session.');
  }
  return header;
}
