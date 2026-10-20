import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestUser,
  type TestCategory,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
import type { RecipeContentMetadata, RecipeDiet } from '../../src/cookbook/recipe-facts.js';
import { loadCookbookExport } from '../../src/cookbook/export-data.js';
import type { CookbookExport, ExportRevision } from '../../src/cookbook/export-types.js';

interface FactsResponse {
  publicId: string;
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  createdAt: string;
  updatedAt: string | null;
}

interface RecipeSummary {
  slug: string;
  diet: RecipeDiet | null;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let category: TestCategory;
let cookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const user: TestUser = await createTestUser(database.pool, { email: 'metadata@example.test' });
  tenant = await assignTenantRole(database.pool, user.principalId, 'metadata-test', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
    'recipe:revision:read',
    'variant:read',
    'variant:update',
  ]);
  category = await createTestCategory(database.pool, tenant.id, 'Metadata', 'metadata');
  const login: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  cookie = String(login.headers['set-cookie']);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

function path(publicId: string): string {
  return `/cookbook/tenants/${tenant.slug}/recipes/${publicId}`;
}

async function create(slug: string, extra: Record<string, unknown> = {}): Promise<FactsResponse> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: slug,
      slug,
      summary: '',
      categoryPublicIds: [category.publicId],
      visibilityOverride: 'PUBLIC',
      discoverabilityOverride: 'DISCOVERABLE',
      isFeatured: true,
      ...extra,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<FactsResponse>();
}

async function publish(publicId: string): Promise<FactsResponse> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path(publicId)}/publish`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<FactsResponse>();
}

async function detail(publicId: string): Promise<FactsResponse> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/recipes/${publicId}`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<FactsResponse>();
}

test('metadata follows publication, draft copying, history, sharing, and export without exposing unpublished changes', async (): Promise<void> => {
  const metadata: RecipeContentMetadata = {
    difficulty: 'EASY',
    totalMinutes: 90,
    activeMinutes: 20,
    kcal: 800,
    servings: 4,
    utensils: 'Whisk\n  Mixing bowl',
  };
  const created: FactsResponse = await create('metadata-lifecycle', { metadata, diet: 'VEGAN' });
  assert.deepEqual(created.metadata, metadata);
  assert.equal(created.updatedAt, null);
  assert.ok(created.createdAt.endsWith('Z'));
  const published: FactsResponse = await publish(created.publicId);
  assert.deepEqual((await detail(created.publicId)).metadata, metadata);
  assert.ok(published.updatedAt?.endsWith('Z'));

  const steps: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path(created.publicId)}/draft/steps`,
    headers: { cookie },
    payload: { steps: [{ instruction: 'Mix.', ingredients: [] }] },
  });
  assert.equal(steps.statusCode, 204, steps.body);
  const copied: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path(created.publicId)}/draft`,
    headers: { cookie },
  });
  assert.deepEqual(copied.json<FactsResponse>().metadata, metadata);
  assert.equal(copied.json<FactsResponse>().diet, 'VEGAN');
  assert.equal(copied.json<FactsResponse>().updatedAt, published.updatedAt);

  const change: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${path(created.publicId)}/draft`,
    headers: { cookie },
    payload: {
      title: 'Changed',
      summary: '',
      categoryPublicIds: [category.publicId],
      metadata: { kcal: 0 },
      diet: null,
    },
  });
  assert.equal(change.statusCode, 200, change.body);
  assert.equal(change.json<FactsResponse>().metadata.servings, null);
  assert.deepEqual((await detail(created.publicId)).metadata, metadata);
  assert.equal((await detail(created.publicId)).updatedAt, published.updatedAt);
  const omission: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${path(created.publicId)}/draft`,
    headers: { cookie },
    payload: { title: 'Changed again', summary: '', categoryPublicIds: [category.publicId] },
  });
  assert.equal(omission.statusCode, 200, omission.body);
  assert.equal(omission.json<FactsResponse>().metadata.kcal, 0);
  const updated: FactsResponse = await publish(created.publicId);
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.updatedAt, published.updatedAt);
  assert.equal(updated.metadata.kcal, 0);
  assert.equal(updated.diet, null);

  const shared: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path(created.publicId)}/share-links`,
    headers: { cookie },
    payload: { name: null, expiresAt: null },
  });
  assert.equal(shared.statusCode, 201, shared.body);
  const token: string = shared.json<{ path: string }>().path.split('/').at(-1)!;
  const sharedDetail: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/share-links/${token}`,
  });
  assert.equal(sharedDetail.statusCode, 200, sharedDetail.body);
  assert.deepEqual(sharedDetail.json<FactsResponse>().metadata, updated.metadata);
  assert.equal(sharedDetail.json<FactsResponse>().updatedAt, updated.updatedAt);

  const exported: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
  assert.deepEqual(
    exported.revisions.find((revision: ExportRevision): boolean => revision.status === 'ARCHIVED')
      ?.metadata,
    metadata,
  );
  const revisions: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path(created.publicId)}/revisions`,
    headers: { cookie },
  });
  const archivedId: string = revisions.json<{ revisions: { publicId: string }[] }>().revisions[1]!
    .publicId;
  const snapshot: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path(created.publicId)}/revisions/${archivedId}`,
    headers: { cookie },
  });
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.deepEqual(snapshot.json<FactsResponse>().metadata, metadata);
});

test('diet hierarchy filters recipes and featured counts and combines with text search', async (): Promise<void> => {
  const expectedDiets: Map<string, RecipeDiet | null> = new Map();
  for (const diet of ['VEGAN', 'VEGETARIAN', 'OMNI', null] as (RecipeDiet | null)[]) {
    const slug: string = `diet-matrix-${diet?.toLowerCase() ?? 'unknown'}`;
    expectedDiets.set(slug, diet);
    const created: FactsResponse = await create(slug, {
      diet,
    });
    await publish(created.publicId);
    if (diet === 'VEGAN') {
      const draft: LightMyRequestResponse = await api.inject({
        method: 'PATCH',
        url: `${path(created.publicId)}/draft`,
        headers: { cookie },
        payload: { title: slug, summary: '', categoryPublicIds: [category.publicId], diet: 'OMNI' },
      });
      assert.equal(draft.statusCode, 200, draft.body);
    }
  }
  for (const [diet, expected] of [
    ['VEGAN', 1],
    ['VEGETARIAN', 2],
    ['OMNI', 3],
    ['', 4],
  ] as [string, number][]) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `/cookbook?tenantSlug=${tenant.slug}&recipeFilter=diet-matrix${diet === '' ? '' : `&diet=${diet}`}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body: {
      recipes: RecipeSummary[];
      frontpage: { recipes: RecipeSummary[]; totalRecipes: number };
    } = response.json();
    assert.equal(body.recipes.length, expected, diet);
    assert.equal(body.frontpage.totalRecipes, expected, diet);
    for (const recipe of [...body.recipes, ...body.frontpage.recipes]) {
      assert.equal(recipe.diet, expectedDiets.get(recipe.slug), recipe.slug);
    }
    if (diet !== '')
      assert.ok(
        !body.recipes.some((recipe: { slug: string }): boolean => recipe.slug.endsWith('unknown')),
      );
  }
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook?tenantSlug=${tenant.slug}&diet=INVALID`,
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test('incomplete optional metadata is valid while invalid values and timestamp edits are rejected', async (): Promise<void> => {
  await create('calories-only', { metadata: { kcal: 600 } });
  await create('servings-only', { metadata: { servings: 2.5 } });
  const recipe: FactsResponse = await create('empty-facts');
  assert.equal(recipe.metadata.kcal, null);
  assert.equal(recipe.diet, null);
  const invalid: Record<string, unknown>[] = [
    { metadata: { servings: 0 } },
    { metadata: { totalMinutes: 10, activeMinutes: 20 } },
    { metadata: { kcal: -1 } },
    { diet: 'INVALID' },
    { createdAt: '2020-01-01T00:00:00Z' },
    { metadata: { kcalPerServing: 200 } },
  ];
  for (const extra of invalid) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'PATCH',
      url: `${path(recipe.publicId)}/draft`,
      headers: { cookie },
      payload: { title: 'Invalid', summary: '', categoryPublicIds: [category.publicId], ...extra },
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});
