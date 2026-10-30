import type { Pool, PoolClient, QueryResult } from 'pg';
import { removeRecipeImageFiles } from './recipe-image-storage.js';

export async function cleanupRecipeTrash(pool: Pool, directory: string): Promise<void> {
  const candidates: QueryResult<{ id: string }> = await pool.query<{ id: string }>(
    `SELECT id FROM recipe WHERE deleted_at IS NOT NULL
       AND deleted_at + deletion_retention_days * interval '24 hours' <= now()`,
  );
  for (const candidate of candidates.rows) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked: QueryResult = await client.query(
        `SELECT id FROM recipe WHERE id = $1 AND deleted_at IS NOT NULL
           AND deleted_at + deletion_retention_days * interval '24 hours' <= now() FOR UPDATE`,
        [candidate.id],
      );
      if (locked.rowCount === 1) {
        const assets: QueryResult<{ media_asset_id: string }> = await client.query<{
          media_asset_id: string;
        }>(
          `SELECT DISTINCT media.media_asset_id FROM recipe_revision_media AS media
           INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
           WHERE revision.recipe_id = $1`,
          [candidate.id],
        );
        await client.query(
          'UPDATE recipe SET draft_revision_id = NULL, published_revision_id = NULL WHERE id = $1',
          [candidate.id],
        );
        await client.query(
          `DELETE FROM ai_context_grant WHERE scope_type = 'RECIPE'
             AND tenant_id = (SELECT tenant_id FROM recipe WHERE id = $1)
             AND scope_public_id = (SELECT public_id FROM recipe WHERE id = $1)`,
          [candidate.id],
        );
        await client.query('DELETE FROM recipe WHERE id = $1', [candidate.id]);
        await client.query(
          `WITH removed AS (
             DELETE FROM media_asset WHERE id = ANY($1::uuid[])
               AND NOT EXISTS (SELECT 1 FROM recipe_revision_media WHERE media_asset_id = media_asset.id)
             RETURNING storage_key
           ) INSERT INTO recipe_media_deletion_queue (storage_key)
             SELECT storage_key FROM removed ON CONFLICT DO NOTHING`,
          [assets.rows.map((asset: { media_asset_id: string }): string => asset.media_asset_id)],
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const pending: QueryResult<{ storage_key: string }> = await pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM recipe_media_deletion_queue ORDER BY queued_at',
  );
  for (const entry of pending.rows) {
    await removeRecipeImageFiles(directory, [entry.storage_key]);
    await pool.query('DELETE FROM recipe_media_deletion_queue WHERE storage_key = $1', [
      entry.storage_key,
    ]);
  }
}
