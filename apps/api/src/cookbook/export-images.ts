import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient, QueryResult } from 'pg';
import type { ExportRecipeImage } from './export-types.js';
import { recipeMediaDirectory } from './recipe-image-storage.js';

interface RevisionImageRow {
  revision_public_id: string;
  storage_key: string;
  content_type: string;
  checksum: Buffer;
}

export async function exportRevisionImages(
  client: PoolClient,
  tenantId: string,
): Promise<Map<string, ExportRecipeImage>> {
  const rows: QueryResult<RevisionImageRow> = await client.query<RevisionImageRow>(
    `SELECT revision.public_id AS revision_public_id, asset.storage_key,
       asset.content_type, asset.checksum
     FROM recipe_revision_media AS media
     INNER JOIN media_asset AS asset ON asset.id = media.media_asset_id
     INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
     INNER JOIN recipe ON recipe.id = revision.recipe_id
     WHERE recipe.tenant_id = $1 AND asset.tenant_id = $1 AND media.usage_kind = 'COVER'
     ORDER BY revision.public_id`,
    [tenantId],
  );
  const imagesByRevision: Map<string, ExportRecipeImage> = new Map();
  const imagesByStorageKey: Map<string, ExportRecipeImage> = new Map();
  for (const row of rows.rows) {
    let image: ExportRecipeImage | undefined = imagesByStorageKey.get(row.storage_key);
    if (image === undefined) {
      const bytes: Buffer = await readFile(
        resolve(recipeMediaDirectory(), row.storage_key, 'image.jpg'),
      );
      const checksum: Buffer = createHash('sha256').update(bytes).digest();
      if (row.content_type !== 'image/jpeg' || !checksum.equals(row.checksum)) {
        throw new Error('The recipe export image does not match its stored metadata.');
      }
      image = { content_type: 'image/jpeg', encoding: 'base64', data: bytes.toString('base64') };
      imagesByStorageKey.set(row.storage_key, image);
    }
    imagesByRevision.set(row.revision_public_id, image);
  }
  return imagesByRevision;
}
