import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
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
import type {
  ImportInput,
  MatchCandidate,
  PortableRecipeDocument,
} from '../../src/recipe-import/types.js';
import { requiredImportEntities } from '../../src/recipe-import/required-entities.js';
import { loadCookbookExport } from '../../src/cookbook/export-data.js';
import type { CookbookExport } from '../../src/cookbook/export-types.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let foreignTenant: TestTenant;
let category: TestCategory;
let foreignCategory: TestCategory;
let cookie: string;
let restrictedCookie: string;
let unitId: string;
let foreignIngredientId: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'recipe-import@example.test',
  });
  tenant = await assignTenantRole(database.pool, user.principalId, 'import-cookbook', [
    'recipe:create',
    'recipe:update',
    'variant:create',
    'variant:read',
    'ingredient:create',
    'ingredient:update',
    'unit:create',
  ]);
  category = await createTestCategory(database.pool, tenant.id, 'Salads', 'salads');
  foreignTenant = await assignTenantRole(database.pool, user.principalId, 'other-import', [
    'recipe:create',
  ]);
  foreignCategory = await createTestCategory(database.pool, foreignTenant.id, 'Other', 'other');
  const ingredient: QueryResult<{ public_id: string }> = await database.pool.query(
    "INSERT INTO ingredient (owner_tenant_id, canonical_name) VALUES ($1, 'Foreign salt') RETURNING public_id",
    [foreignTenant.id],
  );
  foreignIngredientId = ingredient.rows[0]!.public_id;
  await database.pool.query(
    "INSERT INTO ingredient (owner_tenant_id, canonical_name) VALUES ($1, 'Salt')",
    [tenant.id],
  );
  await database.pool.query(
    "INSERT INTO ingredient_alias (ingredient_id, alias) SELECT id, 'Salz' FROM ingredient WHERE owner_tenant_id = $1 AND canonical_name = 'Salt'",
    [tenant.id],
  );
  const unit: QueryResult<{ public_id: string }> = await database.pool.query(
    "INSERT INTO unit (name, symbol, dimension, base_factor, base_offset) VALUES ('Gram', 'g', 'MASS', 1, 0) RETURNING public_id",
  );
  unitId = unit.rows[0]!.public_id;
  cookie = await login(user);
  const restricted: TestUser = await createTestUser(database.pool, {
    email: 'restricted-import@example.test',
  });
  const role: QueryResult<{ id: string }> = await database.pool.query(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Import existing only') RETURNING id",
    [tenant.id],
  );
  await database.pool.query(
    'INSERT INTO tenant_role_permission (tenant_role_id, permission_code) VALUES ($1, $2)',
    [role.rows[0]!.id, 'recipe:create'],
  );
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, restricted.principalId],
  );
  await database.pool.query(
    'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
    [tenant.id, restricted.principalId, role.rows[0]!.id],
  );
  restrictedCookie = await login(restricted);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
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

function example(name: string = 'simple'): PortableRecipeDocument {
  return JSON.parse(
    readFileSync(
      new URL(`../../skills/v1/shadowcook-recipe/examples/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as PortableRecipeDocument;
}

function payload(document: PortableRecipeDocument, slug: string): ImportInput {
  const required = requiredImportEntities(document);
  return {
    json: JSON.stringify(document),
    slug,
    categoryPublicIds: [category.publicId],
    ingredients: required.ingredients.map((source) => ({
      key: source.key,
      action: 'CREATE',
      name: `${source.name} ${slug}`,
    })),
    units: required.units.map((source) =>
      source.key === 'g'
        ? { key: source.key, action: 'EXISTING', publicId: unitId }
        : {
            key: source.key,
            action: 'CREATE',
            name: `${source.name} ${slug}`,
            symbol: `${source.symbol}-${slug}`,
          },
    ),
  };
}

async function submit(
  input: ImportInput,
  session: string = cookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports`,
    headers: { cookie: session },
    payload: input,
  });
}

async function counts(): Promise<object> {
  return (
    await database.pool.query(
      'SELECT (SELECT count(*)::integer FROM recipe) AS recipes, (SELECT count(*)::integer FROM ingredient) AS ingredients, (SELECT count(*)::integer FROM unit) AS units',
    )
  ).rows[0]!;
}

test('preview validates without writes, suggests exact aliases and retains unknown unit ambiguity', async (): Promise<void> => {
  const document: PortableRecipeDocument = example();
  document.ingredients[1]!.name = 'Salz';
  const beforeCounts: object = await counts();
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/preview`,
    headers: { cookie },
    payload: { json: JSON.stringify(document) },
  });
  assert.equal(response.statusCode, 200, response.body);
  const preview: {
    ingredients: { key: string; candidates: MatchCandidate[]; suggestedPublicId: string | null }[];
    units: { suggestedPublicId: string | null }[];
  } = response.json();
  assert.ok(
    response
      .json<{ categories: { public_id: string }[] }>()
      .categories.some((item): boolean => item.public_id === category.publicId),
  );
  assert.equal(
    preview.ingredients.find((item): boolean => item.key === 'salt')!.candidates[0]!.match,
    'ALIAS',
  );
  assert.ok(preview.ingredients.find((item): boolean => item.key === 'salt')!.suggestedPublicId);
  assert.equal(preview.units[0]!.suggestedPublicId, unitId);
  delete document.units[0]!.conversion;
  const unknown: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/preview`,
    headers: { cookie },
    payload: { json: JSON.stringify(document) },
  });
  assert.equal(
    unknown.json<{ units: { suggestedPublicId: string | null }[] }>().units[0]!.suggestedPublicId,
    null,
  );
  assert.deepEqual(await counts(), beforeCounts);
});

test('import creates an unpublished draft with amounts, ordered variants and unverified provenance', async (): Promise<void> => {
  const document: PortableRecipeDocument = example('variants');
  document.recipe.variants[0]!.metadata = { totalMinutes: 15, activeMinutes: 5, servings: 2 };
  document.recipe.variants[0]!.diet = 'VEGAN';
  document.recipe.variants[1]!.metadata = { totalMinutes: 90, utensils: 'Oven' };
  document.recipe.variants[1]!.diet = null;
  const source = {
    instanceUrl: 'https://source.example',
    tenantPublicId: randomUUID(),
    publicId: randomUUID(),
  };
  const lineage: string = randomUUID();
  document.recipe.provenance = { source, revisionPublicId: randomUUID(), lineagePublicId: lineage };
  document.ingredients[0]!.source = { ...source, publicId: randomUUID() };
  document.units[0]!.source = { ...source, tenantPublicId: null, publicId: randomUUID() };
  const response: LightMyRequestResponse = await submit(payload(document, 'imported-soup'));
  assert.equal(response.statusCode, 201, response.body);
  const id: string = response.json<{ publicId: string }>().publicId;
  const state: QueryResult<{
    status: string;
    lineage_public_id: string;
    published_revision_id: string | null;
  }> = await database.pool.query(
    'SELECT revision.status, recipe.lineage_public_id, recipe.published_revision_id FROM recipe INNER JOIN recipe_revision revision ON revision.id = recipe.draft_revision_id WHERE recipe.public_id = $1',
    [id],
  );
  assert.equal(state.rows[0]!.status, 'DRAFT');
  assert.equal(state.rows[0]!.lineage_public_id, lineage);
  assert.equal(state.rows[0]!.published_revision_id, null);
  const variants: QueryResult<{ name: string; steps: number }> = await database.pool.query(
    'SELECT variant.name, count(membership.step_id)::integer AS steps FROM recipe_variant variant INNER JOIN recipe_revision revision ON revision.id = variant.recipe_revision_id INNER JOIN recipe ON recipe.id = revision.recipe_id LEFT JOIN recipe_variant_step_override membership ON membership.variant_id = variant.id WHERE recipe.public_id = $1 GROUP BY variant.id ORDER BY variant.name',
    [id],
  );
  assert.deepEqual(variants.rows.map((variant): number => variant.steps).sort(), [3, 4]);
  assert.equal(
    (
      await database.pool.query(
        "SELECT count(*)::integer AS count FROM unit WHERE name LIKE 'Pinch imported-soup'",
      )
    ).rows[0]!.count,
    0,
  );
  const exported: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
  for (const variant of document.recipe.variants) {
    const imported: CookbookExport['variants'][number] = exported.variants.find(
      (item: CookbookExport['variants'][number]): boolean => item.slug === variant.slug,
    )!;
    assert.equal(imported.metadata.totalMinutes, variant.metadata!.totalMinutes);
    assert.equal(imported.diet, variant.diet);
  }
  assert.equal(
    exported.import_sources.recipes.find((origin): boolean => origin.recipe_public_id === id)!
      .remote_recipe_public_id,
    source.publicId,
  );
  assert.equal(
    exported.import_sources.ingredients.filter((origin): boolean => origin.recipe_public_id === id)
      .length,
    1,
  );
  assert.equal(
    exported.import_sources.units.filter((origin): boolean => origin.recipe_public_id === id)
      .length,
    1,
  );
  assert.equal(
    (await database.pool.query('SELECT count(*)::integer AS count FROM recipe_upstream')).rows[0]!
      .count,
    0,
  );
  await database.pool.query(
    `DELETE FROM ingredient_usage usage USING recipe_step step, recipe_revision revision, recipe
    WHERE usage.recipe_step_id = step.id AND step.recipe_revision_id = revision.id AND revision.recipe_id = recipe.id
      AND recipe.public_id = $1 AND usage.unit_id = (SELECT id FROM unit WHERE public_id = $2)`,
    [id, unitId],
  );
  const afterEditing: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
  assert.ok(afterEditing.units.some((unit): boolean => unit.public_id === unitId));
});

test('foreign selections, incompatible units and duplicate catalogue names roll back every write', async (): Promise<void> => {
  const beforeCounts: object = await counts();
  const foreign: ImportInput = payload(example(), 'foreign-selection');
  foreign.ingredients[1] = { key: 'salt', action: 'EXISTING', publicId: foreignIngredientId };
  assert.equal((await submit(foreign)).statusCode, 409);
  const categories: ImportInput = payload(example(), 'foreign-category');
  categories.categoryPublicIds = [foreignCategory.publicId];
  assert.equal((await submit(categories)).json<{ code: string }>().code, 'INVALID_RECIPE_CATEGORY');
  const document: PortableRecipeDocument = example();
  document.units[0]!.conversion!.baseFactor = '1000';
  assert.equal(
    (await submit(payload(document, 'wrong-unit'))).json<{ code: string }>().code,
    'IMPORT_UNIT_MISMATCH',
  );
  const duplicate: ImportInput = payload(example(), 'duplicate-catalogue');
  duplicate.ingredients[1] = { key: 'salt', action: 'CREATE', name: 'Salt' };
  assert.equal(
    (await submit(duplicate)).json<{ code: string }>().code,
    'IMPORT_CATALOGUE_CONFLICT',
  );
  assert.deepEqual(await counts(), beforeCounts);
});

test('creation permissions, required mapping keys and recipe URL conflicts are enforced', async (): Promise<void> => {
  const beforeCounts: object = await counts();
  const denied: LightMyRequestResponse = await submit(
    payload(example(), 'denied-import'),
    restrictedCookie,
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json<{ code: string }>().code, 'IMPORT_CREATE_PERMISSION_REQUIRED');
  const missing: ImportInput = payload(example(), 'missing-map');
  missing.ingredients.pop();
  assert.equal((await submit(missing)).json<{ code: string }>().code, 'IMPORT_MAPPING_INVALID');
  const duplicateUrl: ImportInput = payload(example(), 'imported-soup');
  assert.equal(
    (await submit(duplicateUrl)).json<{ code: string }>().code,
    'RECIPE_IMPORT_CONFLICT',
  );
  assert.deepEqual(await counts(), beforeCounts);
  const noLogin: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/preview`,
    payload: { json: JSON.stringify(example()) },
  });
  assert.equal(noLogin.statusCode, 401);
});

test('malformed documents report stable issue codes and catalogue search is cookbook-scoped', async (): Promise<void> => {
  const unsupported: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/preview`,
    headers: { cookie, 'content-type': 'application/x-unsupported' },
    payload: '{}',
  });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json<{ code: string }>().code, 'INVALID_RECIPE_IMPORT');
  const catalogue: LightMyRequestResponse = await api.inject({
    url: `/cookbook/tenants/${tenant.slug}/editor-catalogue`,
    headers: { cookie: restrictedCookie },
  });
  assert.equal(catalogue.statusCode, 200);
  assert.deepEqual(
    catalogue
      .json<{ categories: { public_id: string }[] }>()
      .categories.map((item): string => item.public_id),
    [category.publicId],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/preview`,
    headers: { cookie },
    payload: { json: '{"key":"a","key":"b"}' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ issues: { code: string }[] }>().issues[0]!.code, 'DUPLICATE');
  const search: LightMyRequestResponse = await api.inject({
    url: `/cookbook/tenants/${tenant.slug}/recipe-imports/catalogue?kind=INGREDIENT&search=Salt`,
    headers: { cookie },
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.ok(
    !search
      .json<{ candidates: MatchCandidate[] }>()
      .candidates.some(
        (candidate: MatchCandidate): boolean => candidate.publicId === foreignIngredientId,
      ),
  );
});

test('explicit ingredient aliases require update permission, preserve authored names and roll back on failure', async (): Promise<void> => {
  const salt: { public_id: string; id: string } = (
    await database.pool.query<{ public_id: string; id: string }>(
      "SELECT id, public_id FROM ingredient WHERE owner_tenant_id = $1 AND canonical_name = 'Salt'",
      [tenant.id],
    )
  ).rows[0]!;
  const document: PortableRecipeDocument = example();
  document.ingredients[1]!.name = 'Sodium chloride';
  const input: ImportInput = payload(document, 'alias-import');
  input.ingredients[1] = {
    key: 'salt',
    action: 'EXISTING',
    publicId: salt.public_id,
    addAsAlias: true,
  };
  const denied: ImportInput = {
    ...input,
    ingredients: [
      { key: 'tomatoes', action: 'EXISTING', publicId: salt.public_id },
      input.ingredients[1]!,
    ],
  };
  const beforeCounts: object = await counts();
  const deniedResponse: LightMyRequestResponse = await submit(denied, restrictedCookie);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.json<{ code: string }>().code, 'IMPORT_ALIAS_PERMISSION_REQUIRED');
  const invalidUnit: PortableRecipeDocument = structuredClone(document);
  invalidUnit.units[0]!.conversion!.baseFactor = '1000';
  const invalid: LightMyRequestResponse = await submit({
    ...input,
    json: JSON.stringify(invalidUnit),
  });
  assert.equal(invalid.json<{ code: string }>().code, 'IMPORT_UNIT_MISMATCH');
  assert.deepEqual(await counts(), beforeCounts);
  assert.equal(
    (
      await database.pool.query(
        'SELECT count(*)::integer AS count FROM ingredient_alias WHERE ingredient_id = $1 AND alias = $2',
        [salt.id, 'Sodium chloride'],
      )
    ).rows[0]!.count,
    0,
  );
  const created: LightMyRequestResponse = await submit(input);
  assert.equal(created.statusCode, 201, created.body);
  const publicId: string = created.json<{ publicId: string }>().publicId;
  const usage: QueryResult<{ alias: string }> = await database.pool.query(
    `SELECT alias.alias FROM ingredient_usage usage INNER JOIN ingredient_alias alias ON alias.id = usage.ingredient_alias_id
     INNER JOIN recipe_step step ON step.id = usage.recipe_step_id INNER JOIN recipe_revision revision ON revision.id = step.recipe_revision_id
     INNER JOIN recipe ON recipe.id = revision.recipe_id WHERE recipe.public_id = $1 AND usage.ingredient_id = $2`,
    [publicId, salt.id],
  );
  assert.deepEqual(
    usage.rows.map((row: { alias: string }): string => row.alias),
    ['Sodium chloride'],
  );
  const again: ImportInput = payload(document, 'alias-import-again');
  again.ingredients[1] = input.ingredients[1]!;
  assert.equal((await submit(again)).statusCode, 201);
  assert.equal(
    (
      await database.pool.query(
        'SELECT count(*)::integer AS count FROM ingredient_alias WHERE ingredient_id = $1 AND alias = $2',
        [salt.id, 'Sodium chloride'],
      )
    ).rows[0]!.count,
    1,
  );
});
