import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { currentSessionUser } from '../auth/session.js';
import { maximumCookbooksPerOwner } from '../admin/registration-settings-routes.js';
import {
  cookbookSlugBase,
  CookbookLimitError,
  createOwnedCookbook,
} from '../cookbook/owned-cookbook.js';

interface CreateCookbookBody {
  cookbookName: string;
}

export function registerAccountRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/account/cookbooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentSessionUser(pool, request);
    if (user === null)
      return reply
        .code(401)
        .send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    const [cookbooks, maximum] = await Promise.all([
      pool.query<{
        name: string;
        slug: string;
        recipeCount: number;
        userCount: number;
        showOnStartPage: boolean;
      }>(
        `SELECT tenant.display_name AS name, tenant.slug,
          (SELECT count(*)::integer FROM recipe WHERE recipe.tenant_id = tenant.id) AS "recipeCount",
          (SELECT count(*)::integer FROM tenant_membership WHERE tenant_membership.tenant_id = tenant.id) AS "userCount",
          tenant.show_on_start_page AS "showOnStartPage"
         FROM tenant WHERE tenant.owner_principal_id = $1 ORDER BY tenant.display_name`,
        [user.principal_id],
      ),
      maximumCookbooksPerOwner(pool),
    ]);
    return reply.send({ cookbooks: cookbooks.rows, maxCookbooksPerOwner: maximum });
  });
  api.get(
    '/account/cookbook-slug-preview',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cookbookName: unknown = (request.query as { cookbookName?: unknown }).cookbookName;
      if (
        typeof cookbookName !== 'string' ||
        cookbookName.trim().length < 3 ||
        cookbookName.trim().length > 120
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_COOKBOOK', error: 'The cookbook details are invalid.' });
      const slug: string = cookbookSlugBase(cookbookName.trim());
      const existing = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM tenant WHERE slug = $1) AS exists',
        [slug],
      );
      return reply.send({ slug, available: existing.rows[0]?.exists !== true });
    },
  );

  api.post('/account/cookbooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentSessionUser(pool, request);
    if (user === null)
      return reply
        .code(401)
        .send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    const body: CreateCookbookBody | null = parseCreateCookbookBody(request.body);
    if (body === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_COOKBOOK', error: 'The cookbook details are invalid.' });
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const cookbook = await createOwnedCookbook(
        client,
        user.principal_id,
        body.cookbookName.trim(),
        await maximumCookbooksPerOwner(pool),
      );
      await client.query('COMMIT');
      return reply.code(201).send({ tenantSlug: cookbook.slug });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof CookbookLimitError)
        return reply
          .code(409)
          .send({ code: 'COOKBOOK_LIMIT_REACHED', error: 'The cookbook limit has been reached.' });
      throw error;
    } finally {
      client.release();
    }
  });
}

function parseCreateCookbookBody(value: unknown): CreateCookbookBody | null {
  if (typeof value !== 'object' || value === null || !('cookbookName' in value)) return null;
  const cookbookName: unknown = value.cookbookName;
  if (typeof cookbookName !== 'string') return null;
  const trimmedName: string = cookbookName.trim();
  return trimmedName.length >= 3 && trimmedName.length <= 120 ? { cookbookName } : null;
}
