import type { PoolClient, QueryResult } from 'pg';
import { permanentlyDeleteRecipe } from '../cookbook/recipe-trash-cleanup.js';
import { safetyError } from './safety-errors.js';
export interface DeletionScope {
  recipeCount: number;
  revisionCount: number;
  shareCount: number;
  mediaCount: number;
  memberCount: number;
}
export async function deletionScope(
  client: PoolClient,
  tenantPublicId: string,
  recipePublicId?: string,
  lock: boolean = false,
): Promise<DeletionScope> {
  const tenant: QueryResult<{ id: string }> = await client.query(
    `SELECT id FROM tenant WHERE public_id=$1 ${lock ? 'FOR UPDATE' : ''}`,
    [tenantPublicId],
  );
  if (!tenant.rows[0]) safetyError(404, 'RESOURCE_NOT_FOUND');
  const id: string = tenant.rows[0].id;
  const recipes: QueryResult<{ id: string }> = await client.query(
    `SELECT id FROM recipe WHERE tenant_id=$1 AND ($2::uuid IS NULL OR public_id=$2) ${lock ? 'ORDER BY id FOR UPDATE' : ''}`,
    [id, recipePublicId ?? null],
  );
  if (recipePublicId && recipes.rowCount !== 1) safetyError(404, 'RESOURCE_NOT_FOUND');
  const ids: string[] = recipes.rows.map((row: { id: string }): string => row.id);
  const counts: QueryResult<DeletionScope> = await client.query(
    `SELECT
    $2::integer AS "recipeCount",
    (SELECT count(*)::integer FROM recipe_revision WHERE recipe_id=ANY($1::uuid[])) AS "revisionCount",
    (SELECT count(*)::integer FROM recipe_share_link WHERE recipe_id=ANY($1::uuid[])) AS "shareCount",
    (SELECT count(DISTINCT media_asset_id)::integer FROM recipe_revision_media m JOIN recipe_revision v ON v.id=m.recipe_revision_id WHERE v.recipe_id=ANY($1::uuid[])) AS "mediaCount",
    (SELECT count(*)::integer FROM tenant_membership WHERE tenant_id=$3) AS "memberCount"`,
    [ids, ids.length, id],
  );
  const result: DeletionScope = counts.rows[0]!;
  if (!recipePublicId)
    result.mediaCount = (
      await client.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM media_asset WHERE tenant_id=$1',
        [id],
      )
    ).rows[0]!.count;
  return result;
}
export async function deleteCookbook(client: PoolClient, publicId: string): Promise<void> {
  const tenant: QueryResult<{ id: string }> = await client.query(
    'SELECT id FROM tenant WHERE public_id=$1 FOR UPDATE',
    [publicId],
  );
  if (!tenant.rows[0]) safetyError(404, 'RESOURCE_NOT_FOUND');
  const id: string = tenant.rows[0].id;
  await client.query('SELECT id FROM media_asset WHERE tenant_id=$1 FOR UPDATE', [id]);
  if (
    (
      await client.query(
        `SELECT 1 FROM media_asset a JOIN recipe_revision_media m ON m.media_asset_id=a.id JOIN recipe_revision v ON v.id=m.recipe_revision_id JOIN recipe r ON r.id=v.recipe_id WHERE a.tenant_id=$1 AND r.tenant_id<>$1 LIMIT 1`,
        [id],
      )
    ).rowCount !== 0
  )
    safetyError(409, 'MEDIA_SHARED_OUTSIDE_SCOPE');
  await client.query(
    'INSERT INTO recipe_media_deletion_queue (storage_key) SELECT storage_key FROM media_asset WHERE tenant_id=$1 ON CONFLICT DO NOTHING',
    [id],
  );
  const recipes: QueryResult<{ id: string }> = await client.query(
    'SELECT id FROM recipe WHERE tenant_id=$1 ORDER BY id FOR UPDATE',
    [id],
  );
  for (const recipe of recipes.rows) await permanentlyDeleteRecipe(client, recipe.id);
  await client.query('DELETE FROM tenant_access_grant WHERE receiving_tenant_public_id=$1', [
    publicId,
  ]);
  await client.query('DELETE FROM tenant_invite WHERE claimed_by_tenant_public_id=$1', [publicId]);
  await client.query('DELETE FROM tenant WHERE id=$1', [id]);
}
