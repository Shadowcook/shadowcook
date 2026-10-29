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

interface SummaryVariant {
  name: string;
  is_default: boolean;
  is_visible: boolean;
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
    'variant:create',
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

test('cookbook and frontpage summaries include only published reader-visible variants', async (): Promise<void> => {
  const created: FactsResponse = await create('variant-card-labels');
  await database.pool.query(
    `INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default, is_visible)
     SELECT recipe.draft_revision_id, gen_random_uuid(),
       'Variante ' || lpad(number::text, 2, '0'), 'variant-' || number, false, true
     FROM recipe CROSS JOIN generate_series(1, 12) AS number
     WHERE recipe.public_id = $1`,
    [created.publicId],
  );
  await database.pool.query(
    `INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default, is_visible)
     SELECT draft_revision_id, gen_random_uuid(), 'Hidden variant', 'hidden', false, false
     FROM recipe WHERE public_id = $1`,
    [created.publicId],
  );
  await publish(created.publicId);
  const draft: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path(created.publicId)}/draft/steps`,
    headers: { cookie },
    payload: { steps: [{ instruction: 'Draft only.', ingredients: [] }] },
  });
  assert.equal(draft.statusCode, 204, draft.body);
  await database.pool.query(
    `UPDATE recipe_variant SET name = 'Unpublished variant'
     FROM recipe WHERE recipe.public_id = $1
       AND recipe_variant.recipe_revision_id = recipe.draft_revision_id`,
    [created.publicId],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook?tenantSlug=${tenant.slug}&recipeFilter=variant-card-labels`,
  });
  assert.equal(response.statusCode, 200, response.body);
  interface VariantSummary {
    variants: SummaryVariant[];
  }
  const body: { recipes: VariantSummary[]; frontpage: { recipes: VariantSummary[] } } =
    response.json();
  assert.equal(body.recipes.length, 1);
  assert.equal(body.frontpage.recipes.length, 1);
  assert.deepEqual(body.frontpage.recipes[0]!.variants, body.recipes[0]!.variants);
  const variants: VariantSummary['variants'] = body.recipes[0]!.variants;
  assert.equal(variants.length, 13);
  assert.equal(variants.filter((variant: SummaryVariant): boolean => variant.is_default).length, 1);
  assert.ok(variants.every((variant: SummaryVariant): boolean => variant.is_visible));
  assert.deepEqual(
    variants
      .filter((variant: SummaryVariant): boolean => !variant.is_default)
      .map((variant: SummaryVariant): string => variant.name),
    Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => `Variante ${String(index + 1).padStart(2, '0')}`,
    ),
  );
});

test('variants keep independent preparation facts through selection, filtering, copying, history and export', async (): Promise<void> => {
  const created: FactsResponse = await create('variant-facts', {
    diet: 'OMNI',
    metadata: { totalMinutes: 90, activeMinutes: 30, kcal: 1200, servings: 4 },
  });
  const base: string = `${path(created.publicId)}/draft/variants`;
  const variantsResponse: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: base,
    headers: { cookie },
  });
  const original: { variantKey: string } = variantsResponse.json<{
    variants: { variantKey: string }[];
  }>().variants[0]!;
  const inserted: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: base,
    headers: { cookie },
    payload: {
      name: 'Plant based',
      slug: 'plant',
      isDefault: false,
      isVisible: true,
      diet: 'VEGAN',
      metadata: {
        difficulty: 'EASY',
        totalMinutes: 20,
        activeMinutes: 10,
        kcal: 600,
        servings: 2,
        utensils: 'Pan',
      },
    },
  });
  assert.equal(inserted.statusCode, 201, inserted.body);
  const variantKey: string = inserted.json<{ variantKey: string }>().variantKey;
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${base}/${variantKey}`,
    headers: { cookie },
    payload: {
      name: 'Plant based',
      slug: 'plant',
      isDefault: false,
      isVisible: true,
      metadata: { totalMinutes: 10, activeMinutes: 20 },
    },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  await publish(created.publicId);
  const selected: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/recipes/${created.publicId}?variant=plant`,
  });
  assert.equal(selected.statusCode, 200, selected.body);
  assert.equal(selected.json<FactsResponse>().diet, 'VEGAN');
  assert.equal(selected.json<FactsResponse>().metadata.totalMinutes, 20);
  assert.equal((await detail(created.publicId)).diet, 'OMNI');
  assert.equal((await detail(created.publicId)).metadata.totalMinutes, 90);
  const filtered: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook?tenantSlug=${tenant.slug}&recipeFilter=variant-facts&diet=VEGAN`,
  });
  assert.equal(filtered.statusCode, 200, filtered.body);
  assert.equal(filtered.json<{ recipes: unknown[] }>().recipes.length, 1);
  const change: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${base}/${variantKey}`,
    headers: { cookie },
    payload: {
      name: 'Plant based',
      slug: 'plant',
      isDefault: false,
      isVisible: false,
      diet: null,
      metadata: { totalMinutes: 40 },
    },
  });
  assert.equal(change.statusCode, 204, change.body);
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/cookbook/recipes/${created.publicId}?variant=plant`,
      })
    ).json<FactsResponse>().metadata.totalMinutes,
    20,
  );
  const draftVariants: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: base,
    headers: { cookie },
  });
  const draft: { variantKey: string; metadata: RecipeContentMetadata; diet: RecipeDiet | null }[] =
    draftVariants.json<{
      variants: { variantKey: string; metadata: RecipeContentMetadata; diet: RecipeDiet | null }[];
    }>().variants;
  assert.equal(
    draft.find(
      (variant: { variantKey: string; metadata: RecipeContentMetadata }): boolean =>
        variant.variantKey === original.variantKey,
    )!.metadata.totalMinutes,
    90,
  );
  assert.equal(
    draft.find(
      (variant: { variantKey: string; metadata: RecipeContentMetadata }): boolean =>
        variant.variantKey === variantKey,
    )!.metadata.totalMinutes,
    40,
  );
  const exported: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
  assert.ok(
    exported.variants.some(
      (variant: CookbookExport['variants'][number]): boolean =>
        variant.variant_key === variantKey &&
        variant.metadata.totalMinutes === 20 &&
        variant.diet === 'VEGAN',
    ),
  );
  assert.ok(
    exported.variants.some(
      (variant: CookbookExport['variants'][number]): boolean =>
        variant.variant_key === variantKey &&
        variant.metadata.totalMinutes === 40 &&
        variant.diet === null,
    ),
  );
  await publish(created.publicId);
  const hidden: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook?tenantSlug=${tenant.slug}&recipeFilter=variant-facts&diet=VEGAN`,
  });
  assert.equal(hidden.json<{ recipes: unknown[] }>().recipes.length, 0);
});

test('new variants inherit default facts before explicit overrides and remain independent', async (): Promise<void> => {
  const metadata: RecipeContentMetadata = {
    difficulty: 'DEMANDING',
    totalMinutes: 120,
    activeMinutes: 35,
    kcal: 900,
    servings: 3,
    utensils: 'Mixer',
  };
  const recipe: FactsResponse = await create('inherited-variant-facts', {
    metadata,
    diet: 'VEGAN',
  });
  await publish(recipe.publicId);
  const base: string = `${path(recipe.publicId)}/draft/variants`;
  const inherited: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: base,
    headers: { cookie },
    payload: { name: 'New default', slug: 'new-default', isDefault: true, isVisible: true },
  });
  assert.equal(inherited.statusCode, 201, inherited.body);
  const inheritedKey: string = inherited.json<{ variantKey: string }>().variantKey;
  interface VariantFacts {
    variantKey: string;
    slug: string;
    metadata: RecipeContentMetadata;
    diet: RecipeDiet | null;
  }
  async function variants(): Promise<VariantFacts[]> {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: base,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<{ variants: VariantFacts[] }>().variants;
  }
  const copied: VariantFacts = (await variants()).find(
    (variant: VariantFacts): boolean => variant.variantKey === inheritedKey,
  )!;
  assert.deepEqual(copied.metadata, metadata);
  assert.equal(copied.diet, 'VEGAN');

  const overridden: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: base,
    headers: { cookie },
    payload: {
      name: 'Cleared',
      slug: 'cleared',
      isDefault: false,
      isVisible: true,
      metadata: {},
      diet: null,
    },
  });
  assert.equal(overridden.statusCode, 201, overridden.body);
  const cleared: VariantFacts = (await variants()).find(
    (variant: VariantFacts): boolean => variant.slug === 'cleared',
  )!;
  assert.equal(cleared.diet, null);
  assert.ok(Object.values(cleared.metadata).every((value: unknown): boolean => value === null));

  const changed: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${base}/${inheritedKey}`,
    headers: { cookie },
    payload: {
      name: 'New default',
      slug: 'new-default',
      isDefault: true,
      isVisible: true,
      metadata: { totalMinutes: 10 },
      diet: 'OMNI',
    },
  });
  assert.equal(changed.statusCode, 204, changed.body);
  const original: VariantFacts = (await variants()).find(
    (variant: VariantFacts): boolean => variant.slug === 'default',
  )!;
  assert.deepEqual(original.metadata, metadata);
  assert.equal(original.diet, 'VEGAN');
  assert.deepEqual((await detail(recipe.publicId)).metadata, metadata);

  const next: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: base,
    headers: { cookie },
    payload: { name: 'Next', slug: 'next', isDefault: false, isVisible: true, diet: null },
  });
  assert.equal(next.statusCode, 201, next.body);
  const nextVariant: VariantFacts = (await variants()).find(
    (variant: VariantFacts): boolean => variant.slug === 'next',
  )!;
  assert.equal(nextVariant.metadata.totalMinutes, 10);
  assert.equal(nextVariant.diet, null);
});
