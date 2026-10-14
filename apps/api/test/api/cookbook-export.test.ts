import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient } from 'pg';
import { createOwnedCookbook, type OwnedCookbook } from '../../src/cookbook/owned-cookbook.js';
import type {
  CookbookExport,
  ExportCategory,
  ExportIngredient,
  ExportIngredientAlias,
  ExportIngredientUsage,
  ExportRecipe,
  ExportRevision,
  ExportStep,
  ExportVariant,
  ExportUnit,
} from '../../src/cookbook/export-types.js';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestTenant,
  createTestUser,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let cookbook: OwnedCookbook;
let owner: TestUser;
let ownerCookie: string;
let otherCookbook: TestTenant;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  owner = await createTestUser(database.pool, { email: 'export-owner@example.test' });
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    cookbook = await createOwnedCookbook(client, owner.principalId, 'Export cookbook', 1);
    await client.query(
      `UPDATE tenant SET default_recipe_visibility = 'PRIVATE',
        default_recipe_discoverability = 'UNLISTED', frontpage_recipe_count = 7,
        frontpage_heading = 'Meine Lieblingsrezepte', description = 'Für die Familie',
        show_on_start_page = false WHERE id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO category (tenant_id, name, slug, sort_order) VALUES
        ($1, 'Desserts', 'desserts', 0), ($1, 'Empty category', 'empty-category', 1)`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO category (tenant_id, parent_id, name, slug, sort_order)
       SELECT $1, id, 'Süßspeisen', 'suessspeisen', 0 FROM category WHERE tenant_id = $1 AND slug = 'desserts'`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO ingredient (owner_tenant_id, canonical_name) VALUES ($1, 'Zucker'), ($1, 'Unused ingredient')`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO ingredient_alias (ingredient_id, alias)
       SELECT id, 'Feiner Zucker' FROM ingredient WHERE owner_tenant_id = $1 AND canonical_name = 'Zucker'`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO unit (name, symbol, dimension, base_factor, base_offset) VALUES ('Export grams', 'eg', 'MASS', 1, 0)`,
    );
    await client.query(
      `INSERT INTO unit_translation (unit_id, locale, name, symbol)
       SELECT id, 'de', 'Export Gramm', 'eg' FROM unit WHERE symbol = 'eg'`,
    );
    await client.query(
      `INSERT INTO unit (owner_tenant_id, name, symbol) VALUES ($1, 'Prise', 'Pr.')`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe (tenant_id, lineage_public_id, slug, visibility_override, discoverability_override, is_featured)
       VALUES ($1, gen_random_uuid(), 'creme-brulee', 'PRIVATE', 'UNLISTED', false),
         ($1, gen_random_uuid(), 'draft-only', NULL, NULL, true)`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe_revision (recipe_id, revision_no, status, title, summary, created_by_principal_id, published_at)
       SELECT recipe.id, revision_no, status, 'Crème brûlée 🍲', 'Nicht übersetzen', $2,
         CASE WHEN status = 'DRAFT' THEN NULL ELSE '2026-10-01T12:00:00Z'::timestamptz END
       FROM recipe CROSS JOIN (VALUES (1, 'ARCHIVED'), (2, 'PUBLISHED'), (3, 'DRAFT')) AS history(revision_no, status)
       WHERE recipe.tenant_id = $1 AND recipe.slug = 'creme-brulee'`,
      [cookbook.id, owner.principalId],
    );
    await client.query(
      `INSERT INTO recipe_revision (recipe_id, revision_no, status, title)
       SELECT id, 1, 'DRAFT', 'Unpublished recipe' FROM recipe WHERE tenant_id = $1 AND slug = 'draft-only'`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe_revision_category (recipe_revision_id, category_id)
       SELECT revision.id, category.id FROM recipe_revision AS revision
       INNER JOIN recipe ON recipe.id = revision.recipe_id
       CROSS JOIN category WHERE recipe.tenant_id = $1 AND category.tenant_id = $1 AND category.slug = 'suessspeisen'`,
      [cookbook.id],
    );
    await client.query(
      `UPDATE recipe SET published_revision_id = (SELECT id FROM recipe_revision WHERE recipe_id = recipe.id AND status = 'PUBLISHED'),
        draft_revision_id = (SELECT id FROM recipe_revision WHERE recipe_id = recipe.id AND status = 'DRAFT')
       WHERE tenant_id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction)
       SELECT revision.id, gen_random_uuid(), 0, 'Zucker hinzufügen. {recipe:' || recipe.public_id || '}'
       FROM recipe_revision AS revision INNER JOIN recipe ON recipe.id = revision.recipe_id WHERE recipe.tenant_id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default, is_visible)
       SELECT revision.id, gen_random_uuid(), variant.name, variant.slug, variant.is_default, variant.is_visible
       FROM recipe_revision AS revision INNER JOIN recipe ON recipe.id = revision.recipe_id
       CROSS JOIN (VALUES ('Standard', 'standard', true, true), ('Hidden', 'hidden', false, false)) AS variant(name, slug, is_default, is_visible)
       WHERE recipe.tenant_id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO recipe_variant_step_override (variant_id, step_id, state)
       SELECT variant.id, step.id, 'INCLUDE' FROM recipe_variant AS variant
       INNER JOIN recipe_step AS step ON step.recipe_revision_id = variant.recipe_revision_id
       INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id WHERE recipe.tenant_id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO ingredient_usage (recipe_step_id, usage_key, ingredient_id, ingredient_alias_id, unit_id, amount, is_optional, note, sort_order)
       SELECT step.id, gen_random_uuid(), ingredient.id, alias.id, unit.id, 0.123456789123, true, 'nach Geschmack', 0
       FROM recipe_step AS step INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id
       INNER JOIN ingredient ON ingredient.owner_tenant_id = recipe.tenant_id AND ingredient.canonical_name = 'Zucker'
       INNER JOIN ingredient_alias AS alias ON alias.ingredient_id = ingredient.id
       CROSS JOIN unit WHERE recipe.tenant_id = $1 AND unit.symbol = 'eg'`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO ingredient_usage (recipe_step_id, usage_key, text_override, sort_order)
       SELECT step.id, gen_random_uuid(), 'Freitext-Zutat', 1 FROM recipe_step AS step
       INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id WHERE recipe.tenant_id = $1`,
      [cookbook.id],
    );
    await client.query(
      `INSERT INTO ingredient_usage (recipe_step_id, usage_key, special_kind, note, sort_order)
       SELECT step.id, gen_random_uuid(), 'WAIT', 'Abkühlen lassen', 2 FROM recipe_step AS step
       INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id WHERE recipe.tenant_id = $1`,
      [cookbook.id],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  ownerCookie = await login(owner);
  otherCookbook = await createTestTenant(database.pool, 'other-export-cookbook');
  await createTestCategory(database.pool, otherCookbook.id, 'Foreign category', 'foreign-category');
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('download preserves private and unpublished content, full history and all portable references', async (): Promise<void> => {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: exportPath(),
    headers: { cookie: ownerCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(
    String(response.headers['content-disposition']),
    /^attachment; filename="export-cookbook-\d{8}T\d{6}Z\.shadowcook\.zip"$/,
  );
  const data: CookbookExport = extractExport(response.rawPayload);
  assert.equal(data.format, 'shadowcook-cookbook');
  assert.equal(data.format_version, 1);
  assert.match(data.exported_at, /Z$/);
  assert.equal(data.cookbook.default_recipe_visibility, 'PRIVATE');
  assert.equal(data.cookbook.default_recipe_discoverability, 'UNLISTED');
  assert.equal(data.cookbook.frontpage_recipe_count, 7);
  assert.equal(data.cookbook.frontpage_heading, 'Meine Lieblingsrezepte');
  assert.equal(data.cookbook.description, 'Für die Familie');
  assert.equal(data.cookbook.show_on_start_page, false);
  assert.equal(data.categories.length, 3);
  assert.ok(
    data.categories.some((category: ExportCategory): boolean => category.slug === 'empty-category'),
  );
  assert.equal(
    data.categories.find((category: ExportCategory): boolean => category.slug === 'suessspeisen')
      ?.parent_public_id,
    data.categories.find((category: ExportCategory): boolean => category.slug === 'desserts')
      ?.public_id,
  );
  assert.equal(data.ingredients.length, 2);
  assert.equal(data.ingredient_aliases.length, 1);
  assert.equal(data.units.length, 2);
  assert.deepEqual(
    data.units.find((unit: ExportUnit): boolean => unit.symbol === 'eg')?.translations,
    {
      de: { name: 'Export Gramm', symbol: 'eg' },
    },
  );
  assert.equal(
    data.units.find((unit: ExportUnit): boolean => unit.symbol === 'eg')?.is_instance_owned,
    true,
  );
  assert.equal(
    data.units.find((unit: ExportUnit): boolean => unit.symbol === 'Pr.')?.base_factor,
    null,
  );
  assert.equal(data.recipes.length, 2);
  assert.equal(data.revisions.length, 4);
  assert.equal(data.variants.length, 8);
  assert.equal(data.steps.length, 4);
  assert.equal(data.ingredient_usages.length, 12);
  const recipe: ExportRecipe = data.recipes.find(
    (item: ExportRecipe): boolean => item.slug === 'creme-brulee',
  )!;
  const revisions: ExportRevision[] = data.revisions.filter(
    (revision: ExportRevision): boolean => revision.recipe_public_id === recipe.public_id,
  );
  assert.deepEqual(
    revisions.map((revision: ExportRevision): string => revision.status),
    ['ARCHIVED', 'PUBLISHED', 'DRAFT'],
  );
  assert.equal(recipe.published_revision_public_id, revisions[1]!.public_id);
  assert.equal(recipe.draft_revision_public_id, revisions[2]!.public_id);
  assert.equal(recipe.is_featured, false);
  assert.equal(recipe.visibility_override, 'PRIVATE');
  assert.equal(revisions[0]!.title, 'Crème brûlée 🍲');
  assert.equal(revisions[0]!.summary, 'Nicht übersetzen');
  assert.equal(revisions[0]!.author_display_name, 'Test user');
  assert.deepEqual(revisions[0]!.contributor_display_names, ['Test user']);
  for (const variant of data.variants) {
    const step: ExportStep = data.steps.find(
      (item: ExportStep): boolean => item.revision_public_id === variant.revision_public_id,
    )!;
    assert.deepEqual(variant.included_step_keys, [step.step_key]);
  }
  assert.equal(
    data.variants.filter((variant: ExportVariant): boolean => !variant.is_visible).length,
    4,
  );
  assert.ok(
    data.steps.some((step: ExportStep): boolean =>
      step.instruction.includes(`{recipe:${recipe.public_id}}`),
    ),
  );
  for (const usage of data.ingredient_usages.filter(
    (item: ExportIngredientUsage): boolean => item.amount !== null,
  )) {
    assert.equal(usage.amount, '0.123456789123');
    assert.equal(usage.is_optional, true);
    assert.equal(usage.note, 'nach Geschmack');
    assert.ok(
      data.ingredients.some(
        (item: ExportIngredient): boolean => item.public_id === usage.ingredient_public_id,
      ),
    );
    assert.ok(
      data.ingredient_aliases.some(
        (item: ExportIngredientAlias): boolean =>
          item.public_id === usage.ingredient_alias_public_id,
      ),
    );
    assert.ok(
      data.units.some((item: ExportUnit): boolean => item.public_id === usage.unit_public_id),
    );
  }
  const json: string = JSON.stringify(data);
  assert.doesNotMatch(
    json,
    /Foreign category|export-owner@example|password|token|principal_id|tenant_id|"id":/,
  );
});

test('export includes more than one recipe-management page', async (): Promise<void> => {
  await database.pool.query(
    `INSERT INTO recipe (tenant_id, lineage_public_id, slug)
     SELECT $1, gen_random_uuid(), 'bulk-' || entry FROM generate_series(1, 105) AS entry`,
    [cookbook.id],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: exportPath(),
    headers: { cookie: ownerCookie },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(extractExport(response.rawPayload).recipes.length, 107);
});

test('anonymous users, readers, editors, foreign owners and instance administrators cannot export', async (): Promise<void> => {
  assert.equal((await api.inject({ method: 'GET', url: exportPath() })).statusCode, 401);
  for (const permissions of [
    ['recipe:read'],
    ['recipe:read', 'recipe:create', 'recipe:update'],
    ['tenant:manage'],
  ]) {
    const user: TestUser = await createTestUser(database.pool, {
      email: `denied-${permissions.length}-${permissions[0]?.replace(':', '-')}@example.test`,
    });
    await assignTenantRole(
      database.pool,
      user.principalId,
      `denied-${permissions.length}-${permissions[0]?.replace(':', '-')}`,
      permissions,
    );
    if (permissions[0] === 'recipe:read') {
      await database.pool.query(
        'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
        [cookbook.id, user.principalId],
      );
      await database.pool.query(
        `INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id)
         SELECT $1, $2, id FROM tenant_role WHERE tenant_id = $1 AND name = $3`,
        [cookbook.id, user.principalId, permissions.length === 1 ? 'Viewer' : 'Editor'],
      );
    }
    const cookie: string = await login(user);
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: exportPath(),
      headers: { cookie },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json<{ code: string }>().code, 'TENANT_PERMISSION_REQUIRED');
  }
  const admin: TestUser = await createTestUser(database.pool, {
    email: 'export-admin@example.test',
  });
  await database.pool.query(
    `INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE name = 'administrator'`,
    [admin.principalId],
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: exportPath(),
        headers: { cookie: await login(admin) },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/cookbook/tenants/${otherCookbook.slug}/export`,
        headers: { cookie: ownerCookie },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: '/cookbook/tenants/missing-cookbook/export',
        headers: { cookie: ownerCookie },
      })
    ).statusCode,
    404,
  );
});

test('empty cookbooks produce valid exports and disabled cookbooks cannot be exported', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'empty-export@example.test',
  });
  const empty: TestTenant = await assignTenantRole(
    database.pool,
    user.principalId,
    'empty-export',
    ['tenant:manage'],
  );
  const cookie: string = await login(user);
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/tenants/${empty.slug}/export`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  const data: CookbookExport = extractExport(response.rawPayload);
  assert.deepEqual(data.recipes, []);
  assert.deepEqual(data.revisions, []);
  assert.deepEqual(data.categories, []);
  assert.deepEqual(data.units, []);
  await database.pool.query('UPDATE tenant SET disabled_at = now() WHERE id = $1', [empty.id]);
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/cookbook/tenants/${empty.slug}/export`,
        headers: { cookie },
      })
    ).statusCode,
    404,
  );
});

test('password-change-required sessions cannot export', async (): Promise<void> => {
  await database.pool.query(
    'UPDATE user_account SET password_change_required = true WHERE id = $1',
    [owner.userId],
  );
  try {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: exportPath(),
      headers: { cookie: ownerCookie },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json<{ code: string }>().code, 'PASSWORD_CHANGE_REQUIRED');
  } finally {
    await database.pool.query(
      'UPDATE user_account SET password_change_required = false WHERE id = $1',
      [owner.userId],
    );
  }
});

function exportPath(): string {
  return `/cookbook/tenants/${cookbook.slug}/export`;
}

function extractExport(archive: Buffer): CookbookExport {
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const start: number = 30 + archive.readUInt16LE(26) + archive.readUInt16LE(28);
  const content: Buffer = inflateRawSync(archive.subarray(start, start + archive.readUInt32LE(18)));
  assert.equal(crc32(content), archive.readUInt32LE(14));
  return JSON.parse(content.toString('utf8')) as CookbookExport;
}

async function login(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200);
  return response.headers['set-cookie'] as string;
}
