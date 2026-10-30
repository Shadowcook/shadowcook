import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import { recipeImageRetentionLimit } from '../cookbook/recipe-image-settings.js';

export function registerMediaSettingsRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/media-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    return reply.header('Cache-Control', 'no-store').send({
      maxPublishedRecipeImages: await recipeImageRetentionLimit(pool),
    });
  });

  api.put('/admin/media-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:administer',
    );
    if (principalId === null) return;
    const body: unknown = request.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('maxPublishedRecipeImages' in body) ||
      typeof body.maxPublishedRecipeImages !== 'number' ||
      !Number.isInteger(body.maxPublishedRecipeImages) ||
      body.maxPublishedRecipeImages < 0 ||
      body.maxPublishedRecipeImages > 2_147_483_647
    ) {
      return reply
        .code(400)
        .send({ code: 'INVALID_MEDIA_SETTINGS', error: 'The media settings are invalid.' });
    }
    await pool.query(
      `INSERT INTO instance_media_settings (singleton, max_published_recipe_images, updated_by_principal_id)
       VALUES (true, $1, $2)
       ON CONFLICT (singleton) DO UPDATE SET
         max_published_recipe_images = EXCLUDED.max_published_recipe_images,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id,
         updated_at = now()`,
      [body.maxPublishedRecipeImages, principalId],
    );
    return reply.code(204).send();
  });
}
