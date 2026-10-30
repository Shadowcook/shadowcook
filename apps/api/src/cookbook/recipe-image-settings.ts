import type { Pool, PoolClient, QueryResult } from 'pg';

export async function recipeImageRetentionLimit(
  database: Pool | PoolClient,
  lockSettings: boolean = false,
): Promise<number> {
  const result: QueryResult<{ max_published_recipe_images: number }> = await database.query<{
    max_published_recipe_images: number;
  }>(
    `SELECT max_published_recipe_images FROM instance_media_settings
     WHERE singleton = true${lockSettings ? ' FOR SHARE' : ''}`,
  );
  return result.rows[0]?.max_published_recipe_images ?? 5;
}
