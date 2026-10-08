import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';
import {
  consolidateIngredient,
  convertIngredientToTextOverride,
  separateIngredientAlias,
} from '../ingredient-consolidation.js';

interface IngredientRow {
  public_id: string;
  canonical_name: string;
  usage_count: number;
}

interface AliasRow {
  ingredient_public_id: string;
  public_id: string;
  alias: string;
}

interface IngredientInput {
  canonicalName?: unknown;
  aliases?: unknown;
}

export function registerTenantIngredientRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/ingredients', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:read');
    if (tenantId === null) return;
    const ingredients = await pool.query<IngredientRow>(
      `SELECT ingredient.public_id, ingredient.canonical_name,
         count(ingredient_usage.id)::integer AS usage_count
       FROM ingredient
       LEFT JOIN ingredient_usage ON ingredient_usage.ingredient_id = ingredient.id
       WHERE ingredient.owner_tenant_id = $1
       GROUP BY ingredient.id
       ORDER BY ingredient.canonical_name`,
      [tenantId],
    );
    const aliases = await pool.query<AliasRow>(
      `SELECT ingredient.public_id AS ingredient_public_id, ingredient_alias.public_id, ingredient_alias.alias
       FROM ingredient_alias
       INNER JOIN ingredient ON ingredient.id = ingredient_alias.ingredient_id
       WHERE ingredient.owner_tenant_id = $1
       ORDER BY ingredient_alias.alias`,
      [tenantId],
    );
    return reply.send({
      ingredients: ingredients.rows.map((ingredient: IngredientRow): object => ({
        publicId: ingredient.public_id,
        canonicalName: ingredient.canonical_name,
        usageCount: ingredient.usage_count,
        aliases: aliases.rows
          .filter((alias: AliasRow): boolean => alias.ingredient_public_id === ingredient.public_id)
          .map((alias: AliasRow): object => ({ publicId: alias.public_id, alias: alias.alias })),
      })),
    });
  });

  api.post('/cookbook/tenants/:tenantSlug/ingredients', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:create');
    if (tenantId === null) return;
    const input: { canonicalName: string; aliases: string[] } | null = ingredientInput(
      request.body,
    );
    if (input === null) return invalidIngredient(reply);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT 1
         FROM ingredient
         LEFT JOIN ingredient_alias ON ingredient_alias.ingredient_id = ingredient.id
         WHERE ingredient.owner_tenant_id = $1
           AND (lower(ingredient.canonical_name) = lower($2) OR lower(ingredient_alias.alias) = lower($2))
         LIMIT 1`,
        [tenantId, input.canonicalName],
      );
      if (existing.rowCount !== 0) {
        await client.query('ROLLBACK');
        return ingredientConflict(reply);
      }
      const ingredient = await client.query<IngredientRow>(
        `INSERT INTO ingredient (owner_tenant_id, canonical_name) VALUES ($1, $2)
         RETURNING public_id, canonical_name, 0::integer AS usage_count`,
        [tenantId, input.canonicalName],
      );
      const aliases: AliasRow[] = [];
      for (const alias of input.aliases) {
        const result = await client.query<AliasRow>(
          `INSERT INTO ingredient_alias (ingredient_id, alias)
           VALUES ((SELECT id FROM ingredient WHERE public_id = $1), $2)
           RETURNING $1::uuid AS ingredient_public_id, public_id, alias`,
          [ingredient.rows[0]!.public_id, alias],
        );
        aliases.push(result.rows[0]!);
      }
      await client.query('COMMIT');
      return reply.code(201).send(ingredientResponse(ingredient.rows[0]!, aliases));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return ingredientConflict(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.patch('/cookbook/tenants/:tenantSlug/ingredients/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:update');
    if (tenantId === null) return;
    const name: string | null = nameFrom(request.body, 'canonicalName');
    if (name === null) return invalidIngredient(reply);
    try {
      const result = await pool.query(
        'UPDATE ingredient SET canonical_name = $1 WHERE owner_tenant_id = $2 AND public_id = $3',
        [name, tenantId, (request.params as { publicId: string }).publicId],
      );
      return result.rowCount === 1 ? reply.code(204).send() : ingredientNotFound(reply);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return ingredientConflict(reply);
      throw error;
    }
  });

  api.delete('/cookbook/tenants/:tenantSlug/ingredients/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:update');
    if (tenantId === null) return;
    const result = await pool.query(
      `DELETE FROM ingredient WHERE owner_tenant_id = $1 AND public_id = $2
       AND NOT EXISTS (SELECT 1 FROM ingredient_usage WHERE ingredient_usage.ingredient_id = ingredient.id)`,
      [tenantId, (request.params as { publicId: string }).publicId],
    );
    if (result.rowCount === 1) return reply.code(204).send();
    const exists = await pool.query(
      'SELECT 1 FROM ingredient WHERE owner_tenant_id = $1 AND public_id = $2',
      [tenantId, (request.params as { publicId: string }).publicId],
    );
    return exists.rowCount === 1
      ? reply.code(409).send({ code: 'INGREDIENT_IN_USE', error: 'The ingredient is in use.' })
      : ingredientNotFound(reply);
  });

  api.post(
    '/cookbook/tenants/:tenantSlug/ingredients/:publicId/aliases',
    async (request, reply) => {
      const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:update');
      if (tenantId === null) return;
      const alias: string | null = nameFrom(request.body, 'alias');
      if (alias === null) return invalidAlias(reply);
      try {
        const result = await pool.query<AliasRow>(
          `INSERT INTO ingredient_alias (ingredient_id, alias)
         SELECT id, $1 FROM ingredient WHERE owner_tenant_id = $2 AND public_id = $3
         RETURNING $3::uuid AS ingredient_public_id, public_id, alias`,
          [alias, tenantId, (request.params as { publicId: string }).publicId],
        );
        return result.rowCount === 1
          ? reply
              .code(201)
              .send({ publicId: result.rows[0]!.public_id, alias: result.rows[0]!.alias })
          : ingredientNotFound(reply);
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return ingredientConflict(reply);
        throw error;
      }
    },
  );

  api.delete(
    '/cookbook/tenants/:tenantSlug/ingredients/:publicId/aliases/:aliasPublicId',
    async (request, reply) => {
      const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:update');
      if (tenantId === null) return;
      const result = await separateIngredientAlias(
        pool,
        (request.params as { publicId: string }).publicId,
        (request.params as { aliasPublicId: string }).aliasPublicId,
        tenantId,
      );
      if (result === null) return reply.code(204).send();
      if (result === 'INGREDIENT_CONFLICT')
        return reply.code(409).send({
          code: 'INGREDIENT_CONFLICT',
          error: 'An ingredient with the alias name already exists.',
        });
      return reply.code(404).send({ code: 'ALIAS_NOT_FOUND', error: 'The alias was not found.' });
    },
  );

  registerTenantIngredientConsolidationRoutes(api, pool);

  api.post(
    '/cookbook/tenants/:tenantSlug/ingredients/:publicId/convert-to-note',
    async (request, reply) => {
      const tenantId: string | null = await tenantIdFor(pool, request, reply, 'ingredient:update');
      if (tenantId === null) return;
      const result = await convertIngredientToTextOverride(
        pool,
        (request.params as { publicId: string }).publicId,
        tenantId,
      );
      return result === null ? reply.code(204).send() : ingredientNotFound(reply);
    },
  );
}

function registerTenantIngredientConsolidationRoutes(api: FastifyInstance, pool: Pool): void {
  for (const action of ['convert-to-alias', 'merge'] as const) {
    api.post(
      `/cookbook/tenants/:tenantSlug/ingredients/:publicId/${action}`,
      async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId: string | null = await tenantIdFor(
          pool,
          request,
          reply,
          'ingredient:update',
        );
        if (tenantId === null) return;
        const targetPublicId: string | null = publicIdFrom(request.body);
        if (targetPublicId === null) return invalidConsolidation(reply);
        const result = await consolidateIngredient(
          pool,
          (request.params as { publicId: string }).publicId,
          targetPublicId,
          tenantId,
          action === 'convert-to-alias',
        );
        if (result === null) return reply.code(204).send();
        if (result === 'SOURCE_NOT_FOUND') return ingredientNotFound(reply);
        if (result === 'TARGET_NOT_FOUND')
          return reply.code(404).send({
            code: 'TARGET_INGREDIENT_NOT_FOUND',
            error: 'The target ingredient was not found.',
          });
        return invalidConsolidation(reply);
      },
    );
  }
}

async function tenantIdFor(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
): Promise<string | null> {
  return requireTenantPermission(
    pool,
    request,
    reply,
    (request.params as { tenantSlug: string }).tenantSlug,
    permission,
  );
}

function ingredientInput(value: unknown): { canonicalName: string; aliases: string[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as IngredientInput;
  const canonicalName: string | null = nameFrom(value, 'canonicalName');
  if (canonicalName === null) return null;
  if (input.aliases === undefined) return { canonicalName, aliases: [] };
  if (!Array.isArray(input.aliases)) return null;
  const aliases: string[] = input.aliases
    .map((alias: unknown): string | null => nameFrom({ alias }, 'alias'))
    .filter((alias: string | null): alias is string => alias !== null);
  if (
    aliases.length !== input.aliases.length ||
    new Set(aliases.map((alias: string): string => alias.toLocaleLowerCase())).size !==
      aliases.length
  )
    return null;
  return { canonicalName, aliases };
}

function nameFrom(value: unknown, property: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate: unknown = (value as Record<string, unknown>)[property];
  if (typeof candidate !== 'string') return null;
  const name: string = candidate.trim();
  return name.length > 0 && name.length <= 160 ? name : null;
}

function publicIdFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate: unknown = (value as Record<string, unknown>).targetPublicId;
  return typeof candidate === 'string' && isUuid(candidate) ? candidate : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ingredientResponse(ingredient: IngredientRow, aliases: AliasRow[]): object {
  return {
    publicId: ingredient.public_id,
    canonicalName: ingredient.canonical_name,
    usageCount: ingredient.usage_count,
    aliases: aliases.map((alias: AliasRow): object => ({
      publicId: alias.public_id,
      alias: alias.alias,
    })),
  };
}
function invalidIngredient(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_INGREDIENT', error: 'The ingredient is invalid.' });
}
function ingredientConflict(reply: FastifyReply): FastifyReply {
  return reply.code(409).send({
    code: 'INGREDIENT_CONFLICT',
    error: 'The ingredient name or alias is already in use.',
  });
}
function ingredientNotFound(reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .send({ code: 'INGREDIENT_NOT_FOUND', error: 'The ingredient was not found.' });
}
function invalidAlias(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_ALIAS', error: 'The alias is invalid.' });
}
function invalidConsolidation(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({
    code: 'INVALID_INGREDIENT_CONSOLIDATION',
    error: 'The source and target ingredients must be different.',
  });
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
