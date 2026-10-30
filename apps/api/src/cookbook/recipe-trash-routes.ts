import type { FastifyInstance } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

export function registerRecipeTrashRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/trash', async (request, reply) => {
    const { tenantSlug }: { tenantSlug: string } = request.params as { tenantSlug: string };
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:delete',
    );
    if (tenantId === null) return;
    const recipes: QueryResult = await pool.query(
      `SELECT recipe.public_id AS "publicId", recipe.slug, revision.title,
         recipe.deleted_at AS "deletedAt",
         recipe.deleted_at + recipe.deletion_retention_days * interval '24 hours' AS "expiresAt"
       FROM recipe INNER JOIN recipe_revision AS revision
         ON revision.id = COALESCE(recipe.draft_revision_id, recipe.published_revision_id)
       WHERE recipe.tenant_id = $1 AND recipe.deleted_at IS NOT NULL
         AND recipe.deleted_at + recipe.deletion_retention_days * interval '24 hours' > now()
       ORDER BY recipe.deleted_at DESC, recipe.public_id`,
      [tenantId],
    );
    return reply.send({ recipes: recipes.rows });
  });

  api.delete('/cookbook/tenants/:tenantSlug/recipes/:publicId', async (request, reply) => {
    const { tenantSlug, publicId }: { tenantSlug: string; publicId: string } = request.params as {
      tenantSlug: string;
      publicId: string;
    };
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:delete',
    );
    if (tenantId === null) return;
    const result: QueryResult = await pool.query(
      `UPDATE recipe SET deleted_at = now(), deletion_retention_days = tenant.recipe_retention_days, updated_at = now()
       FROM tenant WHERE tenant.id = recipe.tenant_id AND recipe.tenant_id = $1
         AND recipe.public_id::text = $2 AND recipe.deleted_at IS NULL RETURNING recipe.id`,
      [tenantId, publicId],
    );
    if (result.rowCount !== 1)
      return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
    return reply.code(204).send();
  });

  api.post('/cookbook/tenants/:tenantSlug/trash/:publicId/restore', async (request, reply) => {
    const { tenantSlug, publicId }: { tenantSlug: string; publicId: string } = request.params as {
      tenantSlug: string;
      publicId: string;
    };
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:delete',
    );
    if (tenantId === null) return;
    const result: QueryResult = await pool.query(
      `UPDATE recipe SET deleted_at = NULL, deletion_retention_days = NULL, updated_at = now()
       WHERE tenant_id = $1 AND public_id::text = $2 AND deleted_at IS NOT NULL
         AND deleted_at + deletion_retention_days * interval '24 hours' > now() RETURNING id`,
      [tenantId, publicId],
    );
    if (result.rowCount !== 1)
      return reply.code(404).send({
        code: 'RECIPE_NOT_FOUND',
        error: 'The recipe was not found or its retention period has expired.',
      });
    return reply.code(204).send();
  });
}
