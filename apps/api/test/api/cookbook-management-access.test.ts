import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
import { createOwnedCookbook, type OwnedCookbook } from '../../src/cookbook/owned-cookbook.js';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestUser,
  type TestUser,
  type TestTenant,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface ManagementAccess {
  canManageCategories: boolean;
  canManageRecipes: boolean;
  canManageUsers: boolean;
  canManageIngredients: boolean;
  canManageUnits: boolean;
  canManageServiceAccounts: boolean;
}

interface ProtectedRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  payload?: Record<string, unknown>;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let cookbook: OwnedCookbook;
let viewerCookie: string;
let ownerCookie: string;
let editorCookie: string;
let ingredientId: string;
let aliasId: string;
let unitId: string;
let recipeId: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const owner: TestUser = await createTestUser(database.pool, {
    email: 'management-owner@example.test',
  });
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    cookbook = await createOwnedCookbook(client, owner.principalId, 'Management access', 1);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  ownerCookie = await loginCookie(owner);
  viewerCookie = await createMember('Viewer', 'management-viewer@example.test');
  editorCookie = await createMember('Editor', 'management-editor@example.test');
  const ingredient: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${tenantPath()}/ingredients`,
    headers: { cookie: ownerCookie },
    payload: { canonicalName: 'Protected ingredient', aliases: ['Protected alias'] },
  });
  assert.equal(ingredient.statusCode, 201, ingredient.body);
  ingredientId = ingredient.json<{ publicId: string }>().publicId;
  aliasId = ingredient.json<{ aliases: { publicId: string }[] }>().aliases[0]!.publicId;
  const unit: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${tenantPath()}/units`,
    headers: { cookie: ownerCookie },
    payload: { name: 'Protected unit', symbol: 'pu' },
  });
  assert.equal(unit.statusCode, 201, unit.body);
  unitId = unit.json<{ publicId: string }>().publicId;
  const recipe: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${tenantPath()}/recipes`,
    headers: { cookie: ownerCookie },
    payload: {
      title: 'Private draft',
      summary: null,
      slug: 'private-draft',
      categoryPublicIds: [],
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: false,
    },
  });
  assert.equal(recipe.statusCode, 201, recipe.body);
  recipeId = recipe.json<{ publicId: string }>().publicId;
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('the initial Viewer role has no cookbook management access flags', async (): Promise<void> => {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook?tenantSlug=${cookbook.slug}`,
    headers: { cookie: viewerCookie },
  });
  assert.equal(response.statusCode, 200);
  const access: ManagementAccess = response.json<ManagementAccess>();
  for (const field of [
    'canManageCategories',
    'canManageRecipes',
    'canManageUsers',
    'canManageIngredients',
    'canManageUnits',
    'canManageServiceAccounts',
  ] as const) {
    assert.equal(access[field], false, field);
  }
});

test('Viewer cannot read any cookbook management section or editor catalogue', async (): Promise<void> => {
  const paths: string[] = [
    'ingredients',
    'units',
    'categories',
    'recipes',
    'drafts',
    'recipe-policy',
    'service-accounts',
    'editor-catalogue',
    'editor-catalogue/ingredients?search=Protected',
    'editor-catalogue/recipes',
    `recipes/${recipeId}/draft`,
    `recipes/${recipeId}/draft/steps`,
    `recipes/${recipeId}/revisions`,
  ];
  for (const path of paths) {
    await assertDenied({ method: 'GET', path: `${tenantPath()}/${path}` });
  }
  await assertDenied({ method: 'GET', path: `/cookbook/tenant-users?tenantSlug=${cookbook.slug}` });
});

test('Viewer cannot create, modify, delete or consolidate ingredients and units', async (): Promise<void> => {
  const ingredientPath: string = `${tenantPath()}/ingredients/${ingredientId}`;
  const unitPath: string = `${tenantPath()}/units/${unitId}`;
  const requests: ProtectedRequest[] = [
    {
      method: 'POST',
      path: `${tenantPath()}/ingredients`,
      payload: { canonicalName: 'Forbidden' },
    },
    { method: 'PATCH', path: ingredientPath, payload: { canonicalName: 'Forbidden' } },
    { method: 'DELETE', path: ingredientPath },
    { method: 'POST', path: `${ingredientPath}/aliases`, payload: { alias: 'Forbidden' } },
    { method: 'DELETE', path: `${ingredientPath}/aliases/${aliasId}` },
    { method: 'POST', path: `${ingredientPath}/merge`, payload: { targetPublicId: ingredientId } },
    {
      method: 'POST',
      path: `${ingredientPath}/convert-to-alias`,
      payload: { targetPublicId: ingredientId },
    },
    { method: 'POST', path: `${ingredientPath}/convert-to-note` },
    { method: 'POST', path: `${tenantPath()}/units`, payload: { name: 'Forbidden', symbol: 'f' } },
    { method: 'PATCH', path: unitPath, payload: { name: 'Forbidden', symbol: 'f' } },
    { method: 'DELETE', path: unitPath },
  ];
  for (const request of requests) await assertDenied(request);
  const ingredient: QueryResult<{ canonical_name: string; alias: string }> =
    await database.pool.query(
      `SELECT ingredient.canonical_name, ingredient_alias.alias FROM ingredient
     INNER JOIN ingredient_alias ON ingredient_alias.ingredient_id = ingredient.id
     WHERE ingredient.public_id = $1`,
      [ingredientId],
    );
  assert.deepEqual(ingredient.rows, [
    { canonical_name: 'Protected ingredient', alias: 'Protected alias' },
  ]);
  const unit: QueryResult<{ name: string; symbol: string }> = await database.pool.query(
    'SELECT name, symbol FROM unit WHERE public_id = $1',
    [unitId],
  );
  assert.deepEqual(unit.rows, [{ name: 'Protected unit', symbol: 'pu' }]);
});

test('Owner and Editor retain ingredient, unit and draft management access', async (): Promise<void> => {
  for (const cookie of [ownerCookie, editorCookie]) {
    const overview: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `/cookbook?tenantSlug=${cookbook.slug}`,
      headers: { cookie },
    });
    assert.equal(overview.statusCode, 200);
    const access: ManagementAccess = overview.json<ManagementAccess>();
    assert.equal(access.canManageIngredients, true);
    assert.equal(access.canManageUnits, true);
    assert.equal(access.canManageRecipes, true);
    for (const path of ['ingredients', 'units', 'drafts']) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url: `${tenantPath()}/${path}`,
        headers: { cookie },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
  }
});

test('management lists require authentication', async (): Promise<void> => {
  for (const path of ['ingredients', 'units', 'drafts']) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `${tenantPath()}/${path}`,
    });
    assert.equal(response.statusCode, 401);
  }
});

test('each catalogue write permission grants only its own tenant management list', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'catalogue-manager@example.test',
  });
  const cookie: string = await loginCookie(user);
  for (const permission of [
    'ingredient:create',
    'ingredient:update',
    'unit:create',
    'unit:update',
    'unit:delete',
  ]) {
    const tenant: TestTenant = await assignTenantRole(
      database.pool,
      user.principalId,
      permission.replace(':', '-'),
      [permission],
    );
    const isIngredient: boolean = permission.startsWith('ingredient:');
    const overview: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `/cookbook?tenantSlug=${tenant.slug}`,
      headers: { cookie },
    });
    assert.equal(overview.statusCode, 200);
    const access: ManagementAccess = overview.json<ManagementAccess>();
    assert.equal(access.canManageIngredients, isIngredient);
    assert.equal(access.canManageUnits, !isIngredient);
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `/cookbook/tenants/${tenant.slug}/${isIngredient ? 'ingredients' : 'units'}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  for (const path of ['ingredients', 'units']) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `${tenantPath()}/${path}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 403);
  }
});

function tenantPath(): string {
  return `/cookbook/tenants/${cookbook.slug}`;
}

async function assertDenied(request: ProtectedRequest): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: request.method,
    url: request.path,
    headers: { cookie: viewerCookie },
    payload: request.payload,
  });
  assert.equal(response.statusCode, 403, `${request.method} ${request.path}: ${response.body}`);
  assert.equal(response.json<{ code: string }>().code, 'TENANT_PERMISSION_REQUIRED');
}

async function createMember(role: 'Viewer' | 'Editor', email: string): Promise<string> {
  const user: TestUser = await createTestUser(database.pool, { email });
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [cookbook.id, user.principalId],
  );
  await database.pool.query(
    `INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id)
     SELECT $1, $2, id FROM tenant_role WHERE tenant_id = $1 AND name = $3`,
    [cookbook.id, user.principalId, role],
  );
  return loginCookie(user);
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
