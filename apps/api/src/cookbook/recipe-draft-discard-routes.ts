import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

interface RecipeDraftState {
  id: string;
  draft_revision_id: string | null;
  published_revision_id: string | null;
}

export function registerRecipeDraftDiscardRoutes(api: FastifyInstance, pool: Pool): void {
  api.delete('/cookbook/tenants/:tenantSlug/recipes/:publicId/draft', async (request, reply) => {
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
      return reply.code(404).send({
        code: 'RECIPE_DRAFT_NOT_FOUND',
        error: 'The recipe draft was not found.',
      });
    }

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result: QueryResult<RecipeDraftState> = await client.query<RecipeDraftState>(
        `SELECT id, draft_revision_id, published_revision_id
         FROM recipe WHERE deleted_at IS NULL AND tenant_id = $1 AND public_id = $2 FOR UPDATE`,
        [tenantId, params.publicId],
      );
      const recipe: RecipeDraftState | undefined = result.rows[0];
      if (recipe === undefined || recipe.draft_revision_id === null) {
        await client.query('ROLLBACK');
        return reply.code(404).send({
          code: 'RECIPE_DRAFT_NOT_FOUND',
          error: 'The recipe draft was not found.',
        });
      }

      // Clear the composite revision reference before deleting its target.
      await client.query(
        'UPDATE recipe SET draft_revision_id = NULL, updated_at = now() WHERE id = $1',
        [recipe.id],
      );
      if (recipe.published_revision_id === null) {
        await client.query('DELETE FROM recipe WHERE id = $1', [recipe.id]);
      } else {
        await client.query("DELETE FROM recipe_revision WHERE id = $1 AND status = 'DRAFT'", [
          recipe.draft_revision_id,
        ]);
      }
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
