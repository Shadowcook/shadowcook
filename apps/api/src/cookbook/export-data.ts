import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { unitTranslationsSql } from '../unit-translations.js';
import { revisionContributorNamesSql } from './recipe-contributors.js';
import { recipeMetadataSql } from './recipe-facts.js';
import { exportImportSources } from './export-import-sources.js';
import type {
  CookbookExport,
  ExportCategory,
  ExportCookbookSettings,
  ExportIngredient,
  ExportIngredientAlias,
  ExportIngredientUsage,
  ExportRecipe,
  ExportRevision,
  ExportStep,
  ExportUnit,
  ExportVariant,
} from './export-types.js';

export async function loadCookbookExport(pool: Pool, tenantId: string): Promise<CookbookExport> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const settings: ExportCookbookSettings[] = await exportRows<ExportCookbookSettings>(
      client,
      `SELECT public_id, display_name, description, slug, default_recipe_visibility,
        default_recipe_discoverability, frontpage_recipe_count, frontpage_heading,
        show_on_start_page, created_at, updated_at FROM tenant WHERE id = $1`,
      tenantId,
    );
    const cookbook: ExportCookbookSettings | undefined = settings[0];
    if (cookbook === undefined) throw new Error('The export cookbook no longer exists.');
    const categories: ExportCategory[] = await exportRows<ExportCategory>(
      client,
      `SELECT category.public_id, parent.public_id AS parent_public_id,
        category.name, category.slug, category.sort_order
       FROM category LEFT JOIN category AS parent ON parent.id = category.parent_id
       WHERE category.tenant_id = $1 ORDER BY category.public_id`,
      tenantId,
    );
    const ingredients: ExportIngredient[] = await exportRows<ExportIngredient>(
      client,
      `SELECT public_id, canonical_name FROM ingredient
       WHERE owner_tenant_id = $1 ORDER BY public_id`,
      tenantId,
    );
    const ingredientAliases: ExportIngredientAlias[] = await exportRows<ExportIngredientAlias>(
      client,
      `SELECT ingredient_alias.public_id, ingredient.public_id AS ingredient_public_id,
        ingredient_alias.alias
       FROM ingredient_alias INNER JOIN ingredient ON ingredient.id = ingredient_alias.ingredient_id
       WHERE ingredient.owner_tenant_id = $1 ORDER BY ingredient_alias.public_id`,
      tenantId,
    );
    const units: ExportUnit[] = await exportRows<ExportUnit>(
      client,
      `SELECT unit.public_id, unit.owner_tenant_id IS NULL AS is_instance_owned,
        unit.name, unit.symbol, unit.localization_key, unit.dimension,
        unit.base_factor::text, unit.base_offset::text,
        ${unitTranslationsSql('unit')} AS translations
       FROM unit WHERE unit.owner_tenant_id = $1 OR EXISTS (
         SELECT 1 FROM ingredient_usage
         INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
         INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
         INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
         WHERE recipe.tenant_id = $1 AND ingredient_usage.unit_id = unit.id
       ) OR EXISTS (
         SELECT 1 FROM recipe_import_unit_source source
         INNER JOIN recipe ON recipe.id = source.recipe_id
         WHERE recipe.tenant_id = $1 AND source.unit_id = unit.id
       ) ORDER BY unit.public_id`,
      tenantId,
    );
    const recipes: ExportRecipe[] = await exportRows<ExportRecipe>(
      client,
      `SELECT recipe.public_id, recipe.lineage_public_id, recipe.slug,
        recipe.visibility_override, recipe.discoverability_override, recipe.is_featured,
        published.public_id AS published_revision_public_id,
        draft.public_id AS draft_revision_public_id, recipe.created_at, recipe.updated_at
       FROM recipe
       LEFT JOIN recipe_revision AS published ON published.id = recipe.published_revision_id
       LEFT JOIN recipe_revision AS draft ON draft.id = recipe.draft_revision_id
       WHERE recipe.tenant_id = $1 ORDER BY recipe.public_id`,
      tenantId,
    );
    const revisions: ExportRevision[] = await exportRows<ExportRevision>(
      client,
      `SELECT revision.public_id, recipe.public_id AS recipe_public_id,
        revision.revision_no, revision.status, revision.title, revision.summary, revision.version, ${recipeMetadataSql('revision')},
        COALESCE(user_account.display_name, service_account.name) AS author_display_name,
        ${revisionContributorNamesSql()} AS contributor_display_names,
        revision.created_at, revision.published_at,
        ARRAY(SELECT category.public_id FROM recipe_revision_category
          INNER JOIN category ON category.id = recipe_revision_category.category_id
          WHERE recipe_revision_category.recipe_revision_id = revision.id
          ORDER BY category.public_id) AS category_public_ids
       FROM recipe_revision AS revision INNER JOIN recipe ON recipe.id = revision.recipe_id
       LEFT JOIN user_account ON user_account.principal_id = revision.created_by_principal_id
       LEFT JOIN service_account ON service_account.principal_id = revision.created_by_principal_id
       WHERE recipe.tenant_id = $1 ORDER BY recipe.public_id, revision.revision_no`,
      tenantId,
    );
    const variants: ExportVariant[] = await exportRows<ExportVariant>(
      client,
      `SELECT revision.public_id AS revision_public_id, variant.variant_key,
        variant.name, variant.slug, variant.is_default, variant.is_visible,
        ARRAY(SELECT recipe_step.step_key FROM recipe_variant_step_override
          INNER JOIN recipe_step ON recipe_step.id = recipe_variant_step_override.step_id
          WHERE recipe_variant_step_override.variant_id = variant.id
          ORDER BY recipe_step.sort_order) AS included_step_keys
       FROM recipe_variant AS variant
       INNER JOIN recipe_revision AS revision ON revision.id = variant.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id
       WHERE recipe.tenant_id = $1 ORDER BY revision.public_id, variant.variant_key`,
      tenantId,
    );
    const steps: ExportStep[] = await exportRows<ExportStep>(
      client,
      `SELECT revision.public_id AS revision_public_id, step.step_key, step.sort_order, step.instruction
       FROM recipe_step AS step
       INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id
       WHERE recipe.tenant_id = $1 ORDER BY revision.public_id, step.sort_order`,
      tenantId,
    );
    const ingredientUsages: ExportIngredientUsage[] = await exportRows<ExportIngredientUsage>(
      client,
      `SELECT revision.public_id AS revision_public_id, step.step_key, usage.usage_key,
        ingredient.public_id AS ingredient_public_id, alias.public_id AS ingredient_alias_public_id,
        usage.text_override, usage.special_kind, unit.public_id AS unit_public_id,
        usage.amount::text, usage.is_optional, usage.note, usage.sort_order
       FROM ingredient_usage AS usage
       INNER JOIN recipe_step AS step ON step.id = usage.recipe_step_id
       INNER JOIN recipe_revision AS revision ON revision.id = step.recipe_revision_id
       INNER JOIN recipe ON recipe.id = revision.recipe_id
       LEFT JOIN ingredient ON ingredient.id = usage.ingredient_id
       LEFT JOIN ingredient_alias AS alias ON alias.id = usage.ingredient_alias_id
       LEFT JOIN unit ON unit.id = usage.unit_id
       WHERE recipe.tenant_id = $1 ORDER BY revision.public_id, step.sort_order, usage.sort_order`,
      tenantId,
    );
    const result: CookbookExport = {
      import_sources: await exportImportSources(client, tenantId),
      format: 'shadowcook-cookbook',
      format_version: 1,
      exported_at: new Date().toISOString(),
      cookbook,
      categories,
      ingredients,
      ingredient_aliases: ingredientAliases,
      units,
      recipes,
      revisions,
      variants,
      steps,
      ingredient_usages: ingredientUsages,
    };
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function exportRows<Row extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  tenantId: string,
): Promise<Row[]> {
  const result: QueryResult<Row> = await client.query<Row>(sql, [tenantId]);
  // PostgreSQL timestamps are returned as Date objects; normalize every row through JSON.
  return JSON.parse(JSON.stringify(result.rows)) as Row[];
}
