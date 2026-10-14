import type { FastifyInstance } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { requireTenantAnyPermission } from '../admin/authorization.js';

interface SlugAvailabilityQuery {
  slug?: unknown;
  excludePublicId?: unknown;
}

const slugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerRecipeSlugRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/recipes/slug-availability', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantAnyPermission(
      pool,
      request,
      reply,
      tenantSlug,
      ['recipe:create', 'recipe:update'],
    );
    if (tenantId === null) return;

    const query: SlugAvailabilityQuery = request.query as SlugAvailabilityQuery;
    if (
      typeof query.slug !== 'string' ||
      !slugPattern.test(query.slug) ||
      (query.excludePublicId !== undefined &&
        (typeof query.excludePublicId !== 'string' || !uuidPattern.test(query.excludePublicId)))
    ) {
      return reply.code(400).send({
        code: 'INVALID_RECIPE_SLUG_QUERY',
        error: 'The recipe URL name or excluded recipe identifier is invalid.',
      });
    }

    const result: QueryResult<{ available: boolean }> = await pool.query<{ available: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM recipe
         WHERE tenant_id = $1 AND slug = $2
           AND ($3::uuid IS NULL OR public_id <> $3::uuid)
       ) AS available`,
      [tenantId, query.slug, query.excludePublicId ?? null],
    );
    reply.header('Cache-Control', 'no-store');
    return reply.send({ available: result.rows[0]!.available });
  });
}
