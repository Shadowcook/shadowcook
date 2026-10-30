import type { Pool, PoolClient, QueryResult } from 'pg';
import { recipeImageRetentionLimit } from './recipe-image-settings.js';
import { removeRecipeImageFiles } from './recipe-image-storage.js';

// The caller holds the recipe row lock and an open transaction.
export async function pruneRecipeImageHistory(
  client: PoolClient,
  recipeId: string,
): Promise<string[]> {
  const retainedPublishedImages: number = await recipeImageRetentionLimit(client, true);
  if (retainedPublishedImages === 0) return [];
  const detached: QueryResult<{ media_asset_id: string }> = await client.query<{
    media_asset_id: string;
  }>(
    `WITH retained_images AS (
       SELECT media.media_asset_id
       FROM recipe_revision_media AS media
       INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
       WHERE revision.recipe_id = $1 AND revision.status IN ('PUBLISHED', 'ARCHIVED')
         AND media.usage_kind = 'COVER'
       GROUP BY media.media_asset_id
       ORDER BY max(revision.revision_no) DESC, media.media_asset_id
       LIMIT $2
     )
     DELETE FROM recipe_revision_media AS media
     USING recipe_revision AS revision
     WHERE revision.id = media.recipe_revision_id AND revision.recipe_id = $1
       AND revision.status = 'ARCHIVED' AND media.usage_kind = 'COVER'
       AND NOT EXISTS (SELECT 1 FROM retained_images WHERE media_asset_id = media.media_asset_id)
     RETURNING media.media_asset_id`,
    [recipeId, retainedPublishedImages],
  );
  if (detached.rows.length === 0) return [];
  const removed: QueryResult<{ storage_key: string }> = await client.query<{
    storage_key: string;
  }>(
    `DELETE FROM media_asset AS asset
     WHERE asset.id = ANY($1::uuid[])
       AND NOT EXISTS (SELECT 1 FROM recipe_revision_media WHERE media_asset_id = asset.id)
     RETURNING asset.storage_key`,
    [detached.rows.map((row: { media_asset_id: string }): string => row.media_asset_id)],
  );
  return removed.rows.map((row: { storage_key: string }): string => row.storage_key);
}

export async function enforceRecipeImageRetention(pool: Pool, directory: string): Promise<void> {
  const retainedPublishedImages: number = await recipeImageRetentionLimit(pool);
  if (retainedPublishedImages === 0) return;
  const recipes: QueryResult<{ id: string }> = await pool.query<{ id: string }>(
    `SELECT revision.recipe_id AS id
     FROM recipe_revision_media AS media
     INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
     WHERE media.usage_kind = 'COVER' AND revision.status IN ('PUBLISHED', 'ARCHIVED')
     GROUP BY revision.recipe_id
     HAVING count(DISTINCT media.media_asset_id) > $1
     ORDER BY revision.recipe_id`,
    [retainedPublishedImages],
  );
  for (const recipe of recipes.rows) {
    const client: PoolClient = await pool.connect();
    let storageKeys: string[];
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM recipe WHERE id = $1 FOR UPDATE', [recipe.id]);
      storageKeys = await pruneRecipeImageHistory(client, recipe.id);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await removeRecipeImageFiles(directory, storageKeys);
  }
}
