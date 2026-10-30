import { recipeMediaDirectory } from './recipe-image-storage.js';
import { cleanupRecipeImages } from './recipe-image-cleanup.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { currentAuthenticatedPrincipal } from '../auth/principal.js';
import { requireTenantPermission } from '../admin/authorization.js';
import { processRecipeImage, type ProcessedRecipeImage } from './recipe-image-processing.js';

type EnsureDraft = (
  client: PoolClient,
  tenantId: string,
  publicId: string,
  principalId: string | null,
) => Promise<string | null>;

export function recipeImageSql(revision: string): string {
  return `(SELECT '/api/cookbook/media/' || media_asset.public_id::text
    FROM recipe_revision_media INNER JOIN media_asset ON media_asset.id = recipe_revision_media.media_asset_id
    WHERE recipe_revision_media.recipe_revision_id = ${revision}.id AND usage_kind = 'COVER'
    LIMIT 1) AS image_url`;
}

export function registerRecipeImageRoutes(
  api: FastifyInstance,
  pool: Pool,
  ensureDraft: EnsureDraft,
): void {
  let cleaning: boolean = false;
  const cleanup: () => Promise<void> = async (): Promise<void> => {
    if (cleaning) return;
    cleaning = true;
    await cleanupRecipeImages(pool, recipeMediaDirectory())
      .catch((error: unknown): void => api.log.error(error))
      .finally((): void => {
        cleaning = false;
      });
  };
  api.addHook('onReady', cleanup);
  const cleanupTimer: NodeJS.Timeout = setInterval((): void => {
    void cleanup();
  }, 3_600_000);
  cleanupTimer.unref();
  api.addHook('onClose', async (): Promise<void> => {
    clearInterval(cleanupTimer);
  });
  const route: string = '/cookbook/tenants/:tenantSlug/recipes/:publicId/image';
  for (const method of ['PUT', 'DELETE'] as const) {
    api.route({
      method,
      url: route,
      bodyLimit: 1_410_000,
      handler: async (request, reply) => {
        const params: { tenantSlug: string; publicId: string } = request.params as {
          tenantSlug: string;
          publicId: string;
        };
        const tenantId: string | null = await requireTenantPermission(
          pool,
          request,
          reply,
          params.tenantSlug,
          'recipe:update',
        );
        if (tenantId === null) return;
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.publicId)) {
          return reply
            .code(404)
            .send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
        }
        let processed: ProcessedRecipeImage | null = null;
        if (method === 'PUT') {
          try {
            processed = await processRecipeImage(
              (request.body as { image?: unknown } | null)?.image,
            );
          } catch {
            return reply.code(400).send({
              code: 'INVALID_RECIPE_IMAGE',
              error: 'A 1200 by 800 JPEG image is required.',
            });
          }
        }
        const principal = await currentAuthenticatedPrincipal(pool, request);
        const client: PoolClient = await pool.connect();
        const storageKey: string = randomUUID();
        const directory: string = resolve(recipeMediaDirectory(), storageKey);
        let committed: boolean = false;
        try {
          await client.query('BEGIN');
          const revisionId: string | null = await ensureDraft(
            client,
            tenantId,
            params.publicId,
            principal?.principal_id ?? null,
          );
          if (revisionId === null) {
            await client.query('ROLLBACK');
            return reply
              .code(404)
              .send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
          }
          await client.query(
            "DELETE FROM recipe_revision_media WHERE recipe_revision_id = $1 AND usage_kind = 'COVER'",
            [revisionId],
          );
          if (processed !== null) {
            await mkdir(directory, { recursive: true });
            await writeFile(resolve(directory, 'image.jpg'), processed.image);
            await writeFile(resolve(directory, 'thumbnail.jpg'), processed.thumbnail);
            const asset: QueryResult<{ id: string }> = await client.query<{ id: string }>(
              `INSERT INTO media_asset (tenant_id, storage_key, content_type, byte_size, checksum, created_by_principal_id)
             VALUES ($1, $2, 'image/jpeg', $3, $4, $5) RETURNING id`,
              [
                tenantId,
                storageKey,
                processed.image.length + processed.thumbnail.length,
                createHash('sha256').update(processed.image).digest(),
                principal?.principal_id ?? null,
              ],
            );
            await client.query(
              "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, 'COVER')",
              [revisionId, asset.rows[0]!.id],
            );
          }
          await client.query('COMMIT');
          committed = true;
          return reply.code(204).send();
        } catch (error: unknown) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
          if (!committed && processed !== null)
            await rm(directory, { recursive: true, force: true });
        }
      },
    });
  }

  api.get('/cookbook/media/:publicId', async (request, reply) => {
    const publicId: string = (request.params as { publicId: string }).publicId;
    const query: { size?: string; shareToken?: string } = request.query as {
      size?: string;
      shareToken?: string;
    };
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(publicId))
      return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', error: 'Image not found.' });
    const principal = await currentAuthenticatedPrincipal(pool, request);
    const principalId: string | null =
      principal === null || principal.disabled_at !== null ? null : principal.principal_id;
    const result: QueryResult<{ storage_key: string }> = await pool.query<{ storage_key: string }>(
      `SELECT asset.storage_key FROM media_asset AS asset
       WHERE asset.public_id = $1 AND EXISTS (
         SELECT 1 FROM recipe_revision_media AS media
         INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
         INNER JOIN recipe ON recipe.id = revision.recipe_id AND recipe.deleted_at IS NULL
         INNER JOIN tenant ON tenant.id = recipe.tenant_id
         WHERE media.media_asset_id = asset.id AND tenant.disabled_at IS NULL AND (
           EXISTS (SELECT 1 FROM tenant_membership_role AS role
             INNER JOIN tenant_role_permission AS permission ON permission.tenant_role_id = role.tenant_role_id
             WHERE role.tenant_id = tenant.id AND role.principal_id = $2 AND permission.permission_code = 'recipe:update')
           OR (recipe.published_revision_id = revision.id AND (
             COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
             OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'MEMBERS_ONLY'
               AND EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tenant.id AND principal_id = $2))
             OR EXISTS (SELECT 1 FROM tenant_membership_role AS role
               INNER JOIN tenant_role_permission AS permission ON permission.tenant_role_id = role.tenant_role_id
               WHERE role.tenant_id = tenant.id AND role.principal_id = $2 AND permission.permission_code = 'recipe:visibility-update')
             OR EXISTS (SELECT 1 FROM recipe_share_link WHERE recipe_id = recipe.id AND token_hash = $3
               AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()))
           ))
         )
       )`,
      [
        publicId,
        principalId,
        createHash('sha256')
          .update(query.shareToken ?? '')
          .digest(),
      ],
    );
    const asset: { storage_key: string } | undefined = result.rows[0];
    if (asset === undefined)
      return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', error: 'Image not found.' });
    try {
      const bytes: Buffer = await readFile(
        resolve(
          recipeMediaDirectory(),
          asset.storage_key,
          query.size === 'thumbnail' ? 'thumbnail.jpg' : 'image.jpg',
        ),
      );
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type('image/jpeg')
        .send(bytes);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', error: 'Image not found.' });
    }
  });
}
