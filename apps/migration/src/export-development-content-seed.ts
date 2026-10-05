import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { Pool } from 'pg';

interface SeedRow {
  readonly [columnName: string]: boolean | number | string | null;
}

interface ContentSeed {
  ingredient: SeedRow[];
  ingredient_alias: SeedRow[];
  unit: SeedRow[];
  category: SeedRow[];
  recipe: SeedRow[];
  recipe_revision: SeedRow[];
  recipe_revision_category: SeedRow[];
  recipe_variant: SeedRow[];
  recipe_step: SeedRow[];
  recipe_variant_step_override: SeedRow[];
  ingredient_usage: SeedRow[];
}

interface SeedSummary {
  readonly categories: number;
  readonly ingredients: number;
  readonly ingredientAliases: number;
  readonly units: number;
  readonly recipes: number;
  readonly revisions: number;
  readonly variants: number;
  readonly steps: number;
  readonly ingredientUsages: number;
}

const defaultOutputFileName: string = 'development-content-seed.json';

function loadEnvironment(): void {
  const projectRoot: URL = new URL('../../../', import.meta.url);
  const path: string = fileURLToPath(new URL('.env.migration', projectRoot));
  if (existsSync(path)) process.loadEnvFile(path);
}

function requiredEnvironment(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim().length === 0)
    throw new Error(`${name} must be configured before exporting the development content seed.`);
  return value.trim();
}

function optionalEnvironment(name: string): string | null {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim().length === 0) return null;
  return value.trim();
}

function parseExecuteArgument(arguments_: string[]): boolean {
  const unsupported: string[] = arguments_.filter(
    (argument: string): boolean => argument !== '--execute',
  );
  if (unsupported.length > 0)
    throw new Error(`Unsupported export argument '${unsupported[0]}'. Only --execute is accepted.`);
  return arguments_.includes('--execute');
}

function targetDatabaseConnectionString(url: string, username: string, password: string): string {
  const targetUrl: URL = new URL(url);
  if (targetUrl.protocol !== 'postgres:' && targetUrl.protocol !== 'postgresql:') {
    throw new Error('TARGET_DB_URL must use the postgres or postgresql protocol.');
  }
  targetUrl.username = username;
  targetUrl.password = password;
  return targetUrl.toString();
}

function contentSeedOutputPath(configuredPath: string | null): string {
  const projectRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
  const outputPath: string = resolve(projectRoot, configuredPath ?? defaultOutputFileName);
  const relativePath: string = relative(projectRoot, outputPath);
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error('DEVELOPMENT_CONTENT_SEED_PATH must resolve to a file inside the repository.');
  }
  return outputPath;
}

async function readRows(pool: Pool, query: string, tenantId: string): Promise<SeedRow[]> {
  const result = await pool.query<{ value: string }>(query, [tenantId]);
  return result.rows.map((row: { value: string }): SeedRow => JSON.parse(row.value) as SeedRow);
}

async function readContentSeed(pool: Pool, tenantSlug: string): Promise<ContentSeed> {
  const tenantResult = await pool.query<{ id: string }>(
    'SELECT id FROM tenant WHERE slug = $1 AND disabled_at IS NULL',
    [tenantSlug],
  );
  const tenantId: string | undefined = tenantResult.rows[0]?.id;
  if (tenantId === undefined) throw new Error(`Target tenant '${tenantSlug}' does not exist.`);

  return {
    ingredient: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT ingredient.*
         FROM ingredient
         WHERE ingredient.owner_tenant_id = $1
            OR ingredient.id IN (
              SELECT ingredient_usage.ingredient_id
              FROM ingredient_usage
              INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
              INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
              INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
              WHERE recipe.tenant_id = $1 AND ingredient_usage.ingredient_id IS NOT NULL
            )
         ORDER BY ingredient.id
       ) AS content_row`,
      tenantId,
    ),
    ingredient_alias: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT ingredient_alias.*
         FROM ingredient_alias
         INNER JOIN ingredient ON ingredient.id = ingredient_alias.ingredient_id
         WHERE ingredient.owner_tenant_id = $1
            OR ingredient.id IN (
              SELECT ingredient_usage.ingredient_id
              FROM ingredient_usage
              INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
              INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
              INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
              WHERE recipe.tenant_id = $1 AND ingredient_usage.ingredient_id IS NOT NULL
            )
         ORDER BY ingredient_alias.id
       ) AS content_row`,
      tenantId,
    ),
    unit: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT unit.*
         FROM unit
         WHERE unit.owner_tenant_id = $1
            OR unit.id IN (
              SELECT ingredient_usage.unit_id
              FROM ingredient_usage
              INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
              INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
              INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
              WHERE recipe.tenant_id = $1 AND ingredient_usage.unit_id IS NOT NULL
            )
         ORDER BY unit.id
       ) AS content_row`,
      tenantId,
    ),
    category: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         WITH RECURSIVE category_tree AS (
           SELECT category.id, ARRAY[category.sort_order] AS hierarchy_order
           FROM category
           WHERE category.tenant_id = $1 AND category.parent_id IS NULL
           UNION ALL
           SELECT category.id, category_tree.hierarchy_order || category.sort_order
           FROM category
           INNER JOIN category_tree ON category.parent_id = category_tree.id
         )
         SELECT category.*
         FROM category
         INNER JOIN category_tree ON category_tree.id = category.id
         ORDER BY category_tree.hierarchy_order
       ) AS content_row`,
      tenantId,
    ),
    recipe: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (SELECT * FROM recipe WHERE tenant_id = $1 ORDER BY id) AS content_row`,
      tenantId,
    ),
    recipe_revision: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT recipe_revision.*
         FROM recipe_revision
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY recipe_revision.id
       ) AS content_row`,
      tenantId,
    ),
    recipe_revision_category: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT recipe_revision_category.*
         FROM recipe_revision_category
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_revision_category.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY recipe_revision_category.recipe_revision_id, recipe_revision_category.category_id
       ) AS content_row`,
      tenantId,
    ),
    recipe_variant: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT recipe_variant.*
         FROM recipe_variant
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_variant.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY recipe_variant.id
       ) AS content_row`,
      tenantId,
    ),
    recipe_step: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT recipe_step.*
         FROM recipe_step
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY recipe_step.id
       ) AS content_row`,
      tenantId,
    ),
    recipe_variant_step_override: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT recipe_variant_step_override.*
         FROM recipe_variant_step_override
         INNER JOIN recipe_variant ON recipe_variant.id = recipe_variant_step_override.variant_id
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_variant.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY recipe_variant_step_override.variant_id, recipe_variant_step_override.step_id
       ) AS content_row`,
      tenantId,
    ),
    ingredient_usage: await readRows(
      pool,
      `SELECT row_to_json(content_row)::text AS value
       FROM (
         SELECT ingredient_usage.*
         FROM ingredient_usage
         INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1
         ORDER BY ingredient_usage.id
       ) AS content_row`,
      tenantId,
    ),
  };
}

function summary(seed: ContentSeed): SeedSummary {
  return {
    categories: seed.category.length,
    ingredients: seed.ingredient.length,
    ingredientAliases: seed.ingredient_alias.length,
    units: seed.unit.length,
    recipes: seed.recipe.length,
    revisions: seed.recipe_revision.length,
    variants: seed.recipe_variant.length,
    steps: seed.recipe_step.length,
    ingredientUsages: seed.ingredient_usage.length,
  };
}

function printSummary(result: SeedSummary, outputPath: string, executed: boolean): void {
  const mode: string = executed ? `written to ${outputPath}` : 'validated without writing';
  process.stdout.write(
    [
      `Development content seed ${mode}.`,
      `Categories: ${result.categories}`,
      `Recipes: ${result.recipes}`,
      `Revisions: ${result.revisions}`,
      `Variants: ${result.variants}`,
      `Steps: ${result.steps}`,
      `Ingredient and special entries: ${result.ingredientUsages}`,
      `Ingredients: ${result.ingredients}`,
      `Ingredient aliases: ${result.ingredientAliases}`,
      `Units: ${result.units}`,
    ].join('\n') + '\n',
  );
}

async function main(): Promise<void> {
  loadEnvironment();
  const execute: boolean = parseExecuteArgument(process.argv.slice(2));
  const databaseUrl: string = requiredEnvironment('TARGET_DB_URL');
  const databaseUsername: string = requiredEnvironment('TARGET_DB_USERNAME');
  const databasePassword: string = requiredEnvironment('TARGET_DB_PASSWORD');
  const tenantSlug: string = requiredEnvironment('TARGET_DB_TENANT_SLUG');
  const outputPath: string = contentSeedOutputPath(
    optionalEnvironment('DEVELOPMENT_CONTENT_SEED_PATH'),
  );
  const pool: Pool = new Pool({
    connectionString: targetDatabaseConnectionString(
      databaseUrl,
      databaseUsername,
      databasePassword,
    ),
    connectionTimeoutMillis: 15_000,
    max: 1,
  });

  try {
    const seed: ContentSeed = await readContentSeed(pool, tenantSlug);
    printSummary(summary(seed), outputPath, execute);
    if (execute) writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`);
    else process.stdout.write('Run the same command with --execute to write the seed file.\n');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown): void => {
  const message: string = error instanceof Error ? error.message : 'Unknown export failure.';
  process.stderr.write(`Development content seed export failed: ${message}\n`);
  process.exitCode = 1;
});
