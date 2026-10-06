import type { Pool, PoolClient, QueryResult } from 'pg';
import type {
  LegacyCategory,
  LegacyCookbook,
  LegacyIngredientUsage,
  LegacyRecipe,
  LegacyStep,
  LegacyUnit,
  MigrationOptions,
  MigrationSummary,
} from './model.js';
import { parseLegacyIngredient } from './ingredient.js';

interface IdentifierRow {
  id: string;
}

interface TenantRow extends IdentifierRow {
  slug: string;
}

interface UnitIdentifierRow extends IdentifierRow {
  dimension: string;
  base_factor: string;
}

interface IngredientIdentifierRow extends IdentifierRow {}

interface LegacyUnitTarget {
  symbol: string;
  dimension: 'COUNT' | 'MASS' | 'VOLUME';
  baseFactor: string;
  name: string;
}

const specialKindByLegacyUnitId: ReadonlyMap<number, string> = new Map<number, string>([
  [-9, 'NO_ICON'],
  [-8, 'REMOVE'],
  [-7, 'ADD'],
  [-6, 'INFO'],
  [-5, 'IMPORTANT'],
  [-4, 'COOK'],
  [-3, 'COOL'],
  [-2, 'HEAT'],
  [-1, 'WAIT'],
  [0, 'WORK_STEP'],
]);

const targetUnitByLegacyUnitId: ReadonlyMap<number, LegacyUnitTarget> = new Map<
  number,
  LegacyUnitTarget
>([
  [1, { symbol: 'g', dimension: 'MASS', baseFactor: '1', name: 'gram' }],
  [2, { symbol: 'ml', dimension: 'VOLUME', baseFactor: '1', name: 'millilitre' }],
  [3, { symbol: 'tsp', dimension: 'VOLUME', baseFactor: '5', name: 'teaspoon (metric)' }],
  [4, { symbol: 'tbsp', dimension: 'VOLUME', baseFactor: '15', name: 'tablespoon (metric)' }],
  [5, { symbol: 'pc', dimension: 'COUNT', baseFactor: '1', name: 'piece' }],
  [6, { symbol: 'msp', dimension: 'COUNT', baseFactor: '1', name: 'knife tip' }],
  [7, { symbol: 'pck', dimension: 'COUNT', baseFactor: '1', name: 'packet' }],
  [8, { symbol: 'kg', dimension: 'MASS', baseFactor: '1000', name: 'kilogram' }],
  [9, { symbol: 'cl', dimension: 'VOLUME', baseFactor: '10', name: 'centilitre' }],
  [10, { symbol: 'spritzer', dimension: 'COUNT', baseFactor: '1', name: 'spritzer' }],
  [11, { symbol: 'l', dimension: 'VOLUME', baseFactor: '1000', name: 'litre' }],
  [12, { symbol: 'cup', dimension: 'VOLUME', baseFactor: '236.5882365', name: 'cup (US)' }],
]);

const reservedSlugs: ReadonlySet<string> = new Set<string>([
  'admin',
  'api',
  'assets',
  'auth',
  'categories',
  'health',
  'login',
  'logout',
  'recipes',
  'settings',
]);

export async function migrateCookbook(
  pool: Pool,
  cookbook: LegacyCookbook,
  options: MigrationOptions,
): Promise<MigrationSummary> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const tenant: TenantRow = await targetTenant(client, options.tenantSlug);
    await assertEmptyTarget(client, tenant.id);
    const authorPrincipalId: string = await resolveAuthorPrincipalId(
      client,
      tenant.id,
      options.authorPrincipalId,
    );
    const unitResult: { ids: Map<number, string>; created: number } = await resolveUnits(
      client,
      tenant.id,
      cookbook.units,
    );
    const categoryIds: Map<number, string> = await insertCategories(
      client,
      tenant.id,
      cookbook.categories,
    );
    const summary: MigrationSummary = await insertRecipes(
      client,
      tenant.id,
      authorPrincipalId,
      cookbook,
      categoryIds,
      unitResult.ids,
    );
    summary.tenantUnitsCreated = unitResult.created;
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    if (options.execute) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    return summary;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function targetTenant(client: PoolClient, tenantSlug: string): Promise<TenantRow> {
  const result: QueryResult<TenantRow> = await client.query<TenantRow>(
    'SELECT id, slug FROM tenant WHERE slug = $1 AND disabled_at IS NULL FOR UPDATE',
    [tenantSlug],
  );
  const tenant: TenantRow | undefined = result.rows[0];
  if (tenant === undefined)
    throw new Error(`Target tenant '${tenantSlug}' does not exist or is disabled.`);
  return tenant;
}

async function assertEmptyTarget(client: PoolClient, tenantId: string): Promise<void> {
  const result: QueryResult<{ category_count: string; recipe_count: string }> = await client.query<{
    category_count: string;
    recipe_count: string;
  }>(
    `SELECT
       (SELECT count(*) FROM category WHERE tenant_id = $1) AS category_count,
       (SELECT count(*) FROM recipe WHERE tenant_id = $1) AS recipe_count`,
    [tenantId],
  );
  const row: { category_count: string; recipe_count: string } = result.rows[0]!;
  if (row.category_count !== '0' || row.recipe_count !== '0') {
    throw new Error(
      `Target tenant must be empty before migration; found ${row.category_count} categories and ${row.recipe_count} recipes.`,
    );
  }
}

async function resolveAuthorPrincipalId(
  client: PoolClient,
  tenantId: string,
  configuredPrincipalId: string | null,
): Promise<string> {
  if (configuredPrincipalId !== null) {
    const membership: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `SELECT principal_id AS id FROM tenant_membership
       WHERE tenant_id = $1 AND principal_id = $2`,
      [tenantId, configuredPrincipalId],
    );
    if (membership.rows[0] === undefined)
      throw new Error('TARGET_DB_AUTHOR_PRINCIPAL_ID is not a member of the target tenant.');
    return membership.rows[0].id;
  }

  const owners: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
    `SELECT DISTINCT membership_role.principal_id AS id
     FROM tenant_membership_role AS membership_role
     INNER JOIN tenant_role ON tenant_role.id = membership_role.tenant_role_id
     WHERE membership_role.tenant_id = $1 AND tenant_role.name = 'Owner'
     ORDER BY membership_role.principal_id`,
    [tenantId],
  );
  if (owners.rows.length !== 1) {
    throw new Error(
      `Target tenant must have exactly one Owner by default; found ${owners.rows.length}. Configure TARGET_DB_AUTHOR_PRINCIPAL_ID explicitly.`,
    );
  }
  return owners.rows[0]!.id;
}

async function resolveUnits(
  client: PoolClient,
  tenantId: string,
  legacyUnits: LegacyUnit[],
): Promise<{ ids: Map<number, string>; created: number }> {
  const ids: Map<number, string> = new Map<number, string>();
  let created: number = 0;
  for (const legacyUnit of legacyUnits) {
    if (specialKindByLegacyUnitId.has(legacyUnit.id)) continue;
    const target: LegacyUnitTarget | undefined = targetUnitByLegacyUnitId.get(legacyUnit.id);
    if (target === undefined)
      throw new Error(`Legacy unit ${legacyUnit.id} ('${legacyUnit.name}') has no target mapping.`);
    const existing: QueryResult<UnitIdentifierRow> = await client.query<UnitIdentifierRow>(
      `SELECT id, dimension, base_factor::text FROM unit
       WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1) AND lower(symbol) = lower($2)
       ORDER BY owner_tenant_id NULLS FIRST LIMIT 1`,
      [tenantId, target.symbol],
    );
    if (existing.rows[0] !== undefined) {
      const existingUnit: UnitIdentifierRow = existing.rows[0];
      if (
        existingUnit.dimension !== target.dimension ||
        Number(existingUnit.base_factor) !== Number(target.baseFactor)
      ) {
        throw new Error(
          `Target unit '${target.symbol}' does not match the required ${target.dimension} conversion.`,
        );
      }
      ids.set(legacyUnit.id, existingUnit.id);
      continue;
    }
    const inserted: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `INSERT INTO unit (owner_tenant_id, name, symbol, dimension, base_factor, base_offset)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
      [tenantId, target.name, target.symbol, target.dimension, target.baseFactor],
    );
    ids.set(legacyUnit.id, inserted.rows[0]!.id);
    created += 1;
  }
  return { ids, created };
}

async function insertCategories(
  client: PoolClient,
  tenantId: string,
  categories: LegacyCategory[],
): Promise<Map<number, string>> {
  const root: LegacyCategory = categories.find(
    (category: LegacyCategory): boolean => category.parentId < 0,
  )!;
  const pending: LegacyCategory[] = categories.filter(
    (category: LegacyCategory): boolean => category.id !== root.id,
  );
  const insertedIds: Map<number, string> = new Map<number, string>();
  const usedSlugs: Set<string> = new Set<string>();
  const siblingOrder: Map<number, number> = new Map<number, number>();

  while (pending.length > 0) {
    const index: number = pending.findIndex(
      (category: LegacyCategory): boolean =>
        category.parentId === root.id || insertedIds.has(category.parentId),
    );
    if (index < 0) throw new Error('The legacy category hierarchy contains a cycle.');
    const category: LegacyCategory = pending.splice(index, 1)[0]!;
    const parentId: string | null =
      category.parentId === root.id ? null : (insertedIds.get(category.parentId) ?? null);
    const sortOrder: number = siblingOrder.get(category.parentId) ?? 0;
    siblingOrder.set(category.parentId, sortOrder + 1);
    const slug: string = uniqueSlug(category.name, category.id, usedSlugs);
    const inserted: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `INSERT INTO category (tenant_id, parent_id, name, slug, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, parentId, category.name.trim(), slug, sortOrder],
    );
    insertedIds.set(category.id, inserted.rows[0]!.id);
  }
  return insertedIds;
}

async function insertRecipes(
  client: PoolClient,
  tenantId: string,
  authorPrincipalId: string,
  cookbook: LegacyCookbook,
  categoryIds: Map<number, string>,
  unitIds: Map<number, string>,
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    categories: categoryIds.size,
    tenantUnitsCreated: 0,
    tenantIngredientsCreated: 0,
    recipes: 0,
    steps: 0,
    ingredientUsages: 0,
    substitutedEmptyInstructions: 0,
    skippedThumbnailReferences: 0,
  };
  const usedRecipeSlugs: Set<string> = new Set<string>();
  const ingredientIds: Map<string, string> = new Map<string, string>();
  for (const recipe of cookbook.recipes) {
    const recipeSlug: string = uniqueSlug(recipe.name, recipe.id, usedRecipeSlugs);
    const insertedRecipe: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `INSERT INTO recipe (tenant_id, lineage_public_id, slug, is_featured)
       VALUES ($1, gen_random_uuid(), $2, true) RETURNING id`,
      [tenantId, recipeSlug],
    );
    const recipeId: string = insertedRecipe.rows[0]!.id;
    const insertedRevision: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `INSERT INTO recipe_revision
         (recipe_id, revision_no, status, title, summary, created_by_principal_id, published_at)
       VALUES ($1, 1, 'PUBLISHED', $2, $3, $4, now()) RETURNING id`,
      [recipeId, recipe.name.trim(), normalizedOptionalText(recipe.description), authorPrincipalId],
    );
    const revisionId: string = insertedRevision.rows[0]!.id;
    await insertRecipeCategories(client, recipe, revisionId, categoryIds);
    const variant: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
      `INSERT INTO recipe_variant
         (recipe_revision_id, variant_key, name, slug, is_default, is_visible)
       VALUES ($1, gen_random_uuid(), 'Default', 'default', true, true) RETURNING id`,
      [revisionId],
    );
    const variantId: string = variant.rows[0]!.id;
    for (let stepIndex: number = 0; stepIndex < recipe.steps.length; stepIndex += 1) {
      const step: LegacyStep = recipe.steps[stepIndex]!;
      let instruction: string = step.instruction?.trim() ?? '';
      if (instruction.length === 0) {
        instruction = '—';
        summary.substitutedEmptyInstructions += 1;
      }
      const insertedStep: QueryResult<IdentifierRow> = await client.query<IdentifierRow>(
        `INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction)
         VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id`,
        [revisionId, stepIndex, instruction],
      );
      const stepId: string = insertedStep.rows[0]!.id;
      await client.query(
        `INSERT INTO recipe_variant_step_override (variant_id, step_id, state)
         VALUES ($1, $2, 'INCLUDE')`,
        [variantId, stepId],
      );
      for (let usageIndex: number = 0; usageIndex < step.ingredientUsages.length; usageIndex += 1) {
        await insertIngredientUsage(
          client,
          stepId,
          step.ingredientUsages[usageIndex]!,
          usageIndex,
          unitIds,
          tenantId,
          ingredientIds,
          summary,
        );
      }
      summary.steps += 1;
    }
    await client.query('UPDATE recipe SET published_revision_id = $1 WHERE id = $2', [
      revisionId,
      recipeId,
    ]);
    if (normalizedOptionalText(recipe.thumbnail) !== null) summary.skippedThumbnailReferences += 1;
    summary.recipes += 1;
  }
  return summary;
}

async function insertRecipeCategories(
  client: PoolClient,
  recipe: LegacyRecipe,
  revisionId: string,
  categoryIds: Map<number, string>,
): Promise<void> {
  const targetIds: Set<string> = new Set<string>();
  for (const legacyCategoryId of recipe.categoryIds) {
    const targetId: string | undefined = categoryIds.get(legacyCategoryId);
    if (targetId === undefined)
      throw new Error(
        `Legacy recipe ${recipe.id} is assigned to the technical root category or an unknown category.`,
      );
    targetIds.add(targetId);
  }
  for (const categoryId of targetIds) {
    await client.query(
      'INSERT INTO recipe_revision_category (recipe_revision_id, category_id) VALUES ($1, $2)',
      [revisionId, categoryId],
    );
  }
}

async function insertIngredientUsage(
  client: PoolClient,
  stepId: string,
  usage: LegacyIngredientUsage,
  sortOrder: number,
  unitIds: Map<number, string>,
  tenantId: string,
  ingredientIds: Map<string, string>,
  summary: MigrationSummary,
): Promise<void> {
  const specialKind: string | undefined = specialKindByLegacyUnitId.get(usage.unitId);
  let textOverride: string = usage.name?.trim() ?? '';
  const targetUnitId: string | null =
    specialKind === undefined ? (unitIds.get(usage.unitId) ?? null) : null;
  if (specialKind === undefined && targetUnitId === null)
    throw new Error(`Legacy ingredient usage ${usage.id} has no mapped target unit.`);
  let ingredientId: string | null = null;
  let note: string | null = specialKind === undefined ? null : legacySpecialEntryNote(usage.name);
  if (specialKind === undefined) {
    if (textOverride.length === 0)
      throw new Error(`Legacy ingredient usage ${usage.id} has no ingredient name.`);
    const ingredient = parseLegacyIngredient(textOverride);
    ingredientId = await resolveIngredientId(
      client,
      tenantId,
      ingredient.canonicalName,
      ingredientIds,
      summary,
    );
    textOverride = '';
    note = ingredient.note;
  }
  await client.query(
    `INSERT INTO ingredient_usage
       (recipe_step_id, usage_key, ingredient_id, text_override, special_kind, unit_id, amount, is_optional, note, sort_order)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, false, $7, $8)`,
    [
      stepId,
      ingredientId,
      null,
      specialKind ?? null,
      targetUnitId,
      specialKind === undefined ? usage.amount : null,
      note,
      sortOrder,
    ],
  );
  summary.ingredientUsages += 1;
}

async function resolveIngredientId(
  client: PoolClient,
  tenantId: string,
  canonicalName: string,
  ingredientIds: Map<string, string>,
  summary: MigrationSummary,
): Promise<string> {
  const cacheKey: string = canonicalName.normalize('NFKC').toLowerCase();
  const cachedId: string | undefined = ingredientIds.get(cacheKey);
  if (cachedId !== undefined) return cachedId;
  const existing: QueryResult<IngredientIdentifierRow> =
    await client.query<IngredientIdentifierRow>(
      `SELECT id FROM ingredient
     WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1) AND lower(canonical_name) = lower($2)
     ORDER BY owner_tenant_id NULLS FIRST LIMIT 1`,
      [tenantId, canonicalName],
    );
  const existingIngredient: IngredientIdentifierRow | undefined = existing.rows[0];
  if (existingIngredient !== undefined) {
    ingredientIds.set(cacheKey, existingIngredient.id);
    return existingIngredient.id;
  }
  const inserted: QueryResult<IngredientIdentifierRow> =
    await client.query<IngredientIdentifierRow>(
      `INSERT INTO ingredient (owner_tenant_id, canonical_name)
       VALUES ($1, $2) RETURNING id`,
      [tenantId, canonicalName],
    );
  const ingredientId: string = inserted.rows[0]!.id;
  ingredientIds.set(cacheKey, ingredientId);
  summary.tenantIngredientsCreated += 1;
  return ingredientId;
}

function uniqueSlug(name: string, legacyId: number, usedSlugs: Set<string>): string {
  let base: string = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length === 0) base = `legacy-${legacyId}`;
  if (reservedSlugs.has(base)) base = `${base}-${legacyId}`;
  let candidate: string = base;
  if (usedSlugs.has(candidate)) candidate = `${base}-${legacyId}`;
  let suffix: number = 2;
  while (usedSlugs.has(candidate)) {
    candidate = `${base}-${legacyId}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(candidate);
  return candidate;
}

function normalizedOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const normalized: string = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function legacySpecialEntryNote(value: string | null): string | null {
  if (value === null) return null;
  const withoutLegacyCaption: string = value.replace(/<[^>]*>/g, ' ');
  const normalized: string = withoutLegacyCaption
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length === 0 ? null : normalized;
}
