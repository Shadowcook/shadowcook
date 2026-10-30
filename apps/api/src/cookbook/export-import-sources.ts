import type { PoolClient, QueryResult } from 'pg';

export interface ExportRecipeImportSource {
  recipe_public_id: string;
  instance_url: string;
  tenant_public_id: string;
  remote_recipe_public_id: string;
  remote_revision_public_id: string | null;
}

export interface ExportEntityImportSource {
  recipe_public_id: string;
  local_public_id: string;
  instance_url: string;
  remote_tenant_public_id: string | null;
  remote_entity_public_id: string;
}

export interface ExportImportSources {
  recipes: ExportRecipeImportSource[];
  ingredients: ExportEntityImportSource[];
  units: ExportEntityImportSource[];
}

export async function exportImportSources(
  client: PoolClient,
  tenantId: string,
): Promise<ExportImportSources> {
  const recipes: QueryResult<ExportRecipeImportSource> = await client.query(
    `SELECT recipe.public_id AS recipe_public_id, source.instance_url, source.tenant_public_id, source.remote_recipe_public_id, source.remote_revision_public_id
     FROM recipe_import_source source INNER JOIN recipe ON recipe.id = source.recipe_id WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = $1 ORDER BY recipe.public_id`,
    [tenantId],
  );
  const ingredients: QueryResult<ExportEntityImportSource> = await client.query(
    `SELECT recipe.public_id AS recipe_public_id, ingredient.public_id AS local_public_id, source.instance_url, source.remote_tenant_public_id, source.remote_ingredient_public_id AS remote_entity_public_id
     FROM recipe_import_ingredient_source source INNER JOIN recipe ON recipe.id = source.recipe_id INNER JOIN ingredient ON ingredient.id = source.ingredient_id
     WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = $1 ORDER BY recipe.public_id, source.instance_url, source.remote_ingredient_public_id`,
    [tenantId],
  );
  const units: QueryResult<ExportEntityImportSource> = await client.query(
    `SELECT recipe.public_id AS recipe_public_id, unit.public_id AS local_public_id, source.instance_url, source.remote_tenant_public_id, source.remote_unit_public_id AS remote_entity_public_id
     FROM recipe_import_unit_source source INNER JOIN recipe ON recipe.id = source.recipe_id INNER JOIN unit ON unit.id = source.unit_id
     WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = $1 ORDER BY recipe.public_id, source.instance_url, source.remote_unit_public_id`,
    [tenantId],
  );
  return { recipes: recipes.rows, ingredients: ingredients.rows, units: units.rows };
}
