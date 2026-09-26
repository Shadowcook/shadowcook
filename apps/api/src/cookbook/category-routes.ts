import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

interface CategoryRow {
  public_id: string;
  parent_public_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
  can_delete: boolean;
}

interface CategoryInput {
  name: string;
  slug: string;
  parentPublicId: string | null;
}

type CategoryMoveDirection = 'UP' | 'DOWN';

interface CategoryMoveBody {
  direction: CategoryMoveDirection;
}

const slugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'assets',
  'auth',
  'categories',
  'health',
  'login',
  'logout',
  'recipes',
  'settings',
]);

export function registerCategoryRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/categories', async (request, reply) => {
    const tenantId = await tenantIdForRequest(pool, request, reply);
    if (tenantId === null) return;
    return reply.send({ categories: await categoriesForTenant(pool, tenantId) });
  });

  api.post('/cookbook/tenants/:tenantSlug/categories', async (request, reply) => {
    const tenantId = await tenantIdForRequest(pool, request, reply);
    if (tenantId === null) return;
    const input = parseCategoryInput(request.body);
    if (input === null) return invalidCategory(reply);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const parentId = await parentIdFor(client, tenantId, input.parentPublicId);
      if (input.parentPublicId !== null && parentId === null) {
        await client.query('ROLLBACK');
        return reply
          .code(400)
          .send({ code: 'INVALID_CATEGORY_PARENT', error: 'The category parent is invalid.' });
      }
      const result = await client.query<CategoryRow>(
        `INSERT INTO category (tenant_id, parent_id, name, slug, sort_order)
         VALUES ($1, $2, $3, $4,
           COALESCE((SELECT max(sort_order) + 1 FROM category WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2), 0))
        RETURNING public_id,
           (SELECT public_id FROM category AS parent WHERE parent.id = category.parent_id) AS parent_public_id,
           name, slug, sort_order, true AS can_delete`,
        [tenantId, parentId, input.name, input.slug],
      );
      await client.query('COMMIT');
      return reply.code(201).send(categoryResponse(result.rows[0]!));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return categoryConflict(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.patch('/cookbook/tenants/:tenantSlug/categories/:publicId', async (request, reply) => {
    const tenantId = await tenantIdForRequest(pool, request, reply);
    if (tenantId === null) return;
    const input = parseCategoryInput(request.body);
    if (input === null) return invalidCategory(reply);
    const publicId = (request.params as { publicId: string }).publicId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const category = await client.query<{ id: string; parent_id: string | null }>(
        'SELECT id, parent_id FROM category WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      if (category.rows[0] === undefined) {
        await client.query('ROLLBACK');
        return reply
          .code(404)
          .send({ code: 'CATEGORY_NOT_FOUND', error: 'The category was not found.' });
      }
      const parentId = await parentIdFor(client, tenantId, input.parentPublicId);
      if (input.parentPublicId !== null && parentId === null) {
        await client.query('ROLLBACK');
        return reply
          .code(400)
          .send({ code: 'INVALID_CATEGORY_PARENT', error: 'The category parent is invalid.' });
      }
      if (
        parentId !== null &&
        (parentId === category.rows[0].id ||
          (await isDescendant(client, category.rows[0].id, parentId)))
      ) {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          code: 'INVALID_CATEGORY_PARENT',
          error: 'A category cannot be its own descendant.',
        });
      }
      const sortOrder =
        parentId === category.rows[0].parent_id
          ? null
          : await nextSortOrder(client, tenantId, parentId);
      const updated = await client.query<CategoryRow>(
        `UPDATE category SET name = $1, slug = $2, parent_id = $3,
           sort_order = COALESCE($4, sort_order), updated_at = now()
         WHERE id = $5
         RETURNING public_id,
           (SELECT public_id FROM category AS parent WHERE parent.id = category.parent_id) AS parent_public_id,
           name, slug, sort_order,
           NOT EXISTS (
             WITH RECURSIVE subtree AS (
               SELECT category_descendant.id FROM category AS category_descendant WHERE category_descendant.id = category.id
               UNION ALL
               SELECT category_descendant.id
               FROM category AS category_descendant
               INNER JOIN subtree ON category_descendant.parent_id = subtree.id
             )
             SELECT 1 FROM recipe_revision_category
             WHERE recipe_revision_category.category_id IN (SELECT id FROM subtree)
           ) AS can_delete`,
        [input.name, input.slug, parentId, sortOrder, category.rows[0].id],
      );
      await client.query('COMMIT');
      return reply.send(categoryResponse(updated.rows[0]!));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return categoryConflict(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.delete('/cookbook/tenants/:tenantSlug/categories/:publicId', async (request, reply) => {
    const tenantId = await tenantIdForRequest(pool, request, reply);
    if (tenantId === null) return;
    const publicId = (request.params as { publicId: string }).publicId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const category = await client.query<{ id: string }>(
        'SELECT id FROM category WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      if (category.rows[0] === undefined) {
        await client.query('ROLLBACK');
        return reply
          .code(404)
          .send({ code: 'CATEGORY_NOT_FOUND', error: 'The category was not found.' });
      }
      const usage = await client.query<{ in_use: boolean }>(
        `WITH RECURSIVE subtree AS (
           SELECT id FROM category WHERE id = $1
           UNION ALL
           SELECT category.id FROM category INNER JOIN subtree ON category.parent_id = subtree.id
         )
         SELECT EXISTS (
           SELECT 1 FROM recipe_revision_category
           WHERE recipe_revision_category.category_id IN (SELECT id FROM subtree)
         ) AS in_use`,
        [category.rows[0].id],
      );
      if (usage.rows[0]?.in_use === true) {
        await client.query('ROLLBACK');
        return reply
          .code(409)
          .send({ code: 'CATEGORY_IN_USE', error: 'The category is used by recipes.' });
      }
      await client.query('DELETE FROM category WHERE id = $1', [category.rows[0].id]);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  api.post('/cookbook/tenants/:tenantSlug/categories/:publicId/move', async (request, reply) => {
    const tenantId = await tenantIdForRequest(pool, request, reply);
    if (tenantId === null) return;
    const move = parseCategoryMove(request.body);
    if (move === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_CATEGORY_MOVE', error: 'The category move is invalid.' });
    const publicId = (request.params as { publicId: string }).publicId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const category = await client.query<{
        id: string;
        parent_id: string | null;
        sort_order: number;
      }>(
        'SELECT id, parent_id, sort_order FROM category WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      const selected = category.rows[0];
      if (selected === undefined) {
        await client.query('ROLLBACK');
        return reply
          .code(404)
          .send({ code: 'CATEGORY_NOT_FOUND', error: 'The category was not found.' });
      }
      const siblings = await client.query<{ id: string; sort_order: number }>(
        `SELECT id, sort_order FROM category
           WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2
           ORDER BY sort_order ASC, name ASC FOR UPDATE`,
        [tenantId, selected.parent_id],
      );
      const index = siblings.rows.findIndex((sibling) => sibling.id === selected.id);
      const targetIndex = move.direction === 'UP' ? index - 1 : index + 1;
      const adjacent = siblings.rows[targetIndex];
      if (adjacent === undefined) {
        await client.query('COMMIT');
        return reply.code(204).send();
      }
      const temporaryOrder = Math.max(...siblings.rows.map((sibling) => sibling.sort_order)) + 1;
      await client.query('UPDATE category SET sort_order = $1, updated_at = now() WHERE id = $2', [
        temporaryOrder,
        selected.id,
      ]);
      await client.query('UPDATE category SET sort_order = $1, updated_at = now() WHERE id = $2', [
        selected.sort_order,
        adjacent.id,
      ]);
      await client.query('UPDATE category SET sort_order = $1, updated_at = now() WHERE id = $2', [
        adjacent.sort_order,
        selected.id,
      ]);
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

async function tenantIdForRequest(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  return requireTenantPermission(
    pool,
    request,
    reply,
    (request.params as { tenantSlug: string }).tenantSlug,
    'category:update',
  );
}

async function categoriesForTenant(pool: Pool, tenantId: string): Promise<object[]> {
  const result = await pool.query<CategoryRow>(
    `SELECT category.public_id, parent.public_id AS parent_public_id, category.name, category.slug, category.sort_order,
       NOT EXISTS (
         WITH RECURSIVE subtree AS (
           SELECT category_descendant.id FROM category AS category_descendant WHERE category_descendant.id = category.id
           UNION ALL
           SELECT category_descendant.id
           FROM category AS category_descendant
           INNER JOIN subtree ON category_descendant.parent_id = subtree.id
         )
         SELECT 1 FROM recipe_revision_category
         WHERE recipe_revision_category.category_id IN (SELECT id FROM subtree)
       ) AS can_delete
     FROM category LEFT JOIN category AS parent ON parent.id = category.parent_id
     WHERE category.tenant_id = $1 ORDER BY category.sort_order, category.name`,
    [tenantId],
  );
  return result.rows.map(categoryResponse);
}

function parseCategoryInput(value: unknown): CategoryInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const parentPublicId = body.parentPublicId;
  if (
    name.length === 0 ||
    name.length > 160 ||
    !slugPattern.test(slug) ||
    reservedSlugs.has(slug) ||
    (parentPublicId !== null && typeof parentPublicId !== 'string')
  )
    return null;
  return { name, slug, parentPublicId };
}

function parseCategoryMove(value: unknown): CategoryMoveBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const direction = (value as Record<string, unknown>).direction;
  if (direction !== 'UP' && direction !== 'DOWN') return null;
  return { direction };
}

async function parentIdFor(
  client: PoolClient,
  tenantId: string,
  parentPublicId: string | null,
): Promise<string | null> {
  if (parentPublicId === null) return null;
  const result = await client.query<{ id: string }>(
    'SELECT id FROM category WHERE tenant_id = $1 AND public_id = $2',
    [tenantId, parentPublicId],
  );
  return result.rows[0]?.id ?? null;
}

async function nextSortOrder(
  client: PoolClient,
  tenantId: string,
  parentId: string | null,
): Promise<number> {
  const result = await client.query<{ sort_order: number }>(
    `SELECT COALESCE(max(sort_order) + 1, 0) AS sort_order
     FROM category WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
    [tenantId, parentId],
  );
  return result.rows[0]!.sort_order;
}

async function isDescendant(
  client: PoolClient,
  categoryId: string,
  prospectiveParentId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM category WHERE parent_id = $1
       UNION ALL
       SELECT category.id FROM category INNER JOIN descendants ON category.parent_id = descendants.id
     )
     SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2) AS exists`,
    [categoryId, prospectiveParentId],
  );
  return result.rows[0]?.exists === true;
}

function categoryResponse(category: CategoryRow): object {
  return {
    publicId: category.public_id,
    parentPublicId: category.parent_public_id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sort_order,
    canDelete: category.can_delete,
  };
}

function invalidCategory(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_CATEGORY', error: 'The category is invalid.' });
}

function categoryConflict(reply: FastifyReply): FastifyReply {
  return reply
    .code(409)
    .send({ code: 'CATEGORY_CONFLICT', error: 'The category URL name is already in use.' });
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
