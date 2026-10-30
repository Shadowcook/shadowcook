import { cleanupRecipeTrash } from './recipe-trash-cleanup.js';
import { enforceRecipeImageRetention } from './recipe-image-retention.js';
import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, QueryResult } from 'pg';

export async function cleanupRecipeImages(pool: Pool, directory: string): Promise<void> {
  await cleanupRecipeTrash(pool, directory);
  await enforceRecipeImageRetention(pool, directory);
  const removed: QueryResult<{ storage_key: string }> = await pool.query<{ storage_key: string }>(
    `DELETE FROM media_asset WHERE created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM recipe_revision_media WHERE media_asset_id = media_asset.id)
     RETURNING storage_key`,
  );
  for (const row of removed.rows) {
    await rm(resolve(directory, row.storage_key), { recursive: true, force: true });
  }
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (!/^[0-9a-f-]{36}$/.test(name)) continue;
    const path: string = resolve(directory, name);
    let modifiedAt: number;
    try {
      modifiedAt = (await stat(path)).mtimeMs;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (modifiedAt > Date.now() - 86_400_000) continue;
    const asset: QueryResult = await pool.query(
      'SELECT id FROM media_asset WHERE storage_key = $1',
      [name],
    );
    if (asset.rowCount === 0) await rm(path, { recursive: true, force: true });
  }
}
