import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';

interface IngredientRow {
  public_id: string;
  canonical_name: string;
  localization_key: string | null;
  usage_count: number;
}

interface AliasRow {
  ingredient_public_id: string;
  public_id: string;
  alias: string;
  localization_key: string | null;
}

export function registerIngredientRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/ingredients', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const ingredients = await pool.query<IngredientRow>(`
      SELECT ingredient.public_id, ingredient.canonical_name, ingredient.localization_key,
        count(ingredient_usage.id)::integer AS usage_count
      FROM ingredient
      LEFT JOIN ingredient_usage ON ingredient_usage.ingredient_id = ingredient.id
      WHERE ingredient.owner_tenant_id IS NULL
      GROUP BY ingredient.id
      ORDER BY ingredient.canonical_name`);
    const aliases = await pool.query<AliasRow>(`
      SELECT ingredient.public_id AS ingredient_public_id, ingredient_alias.public_id,
        ingredient_alias.alias, ingredient_alias.localization_key
      FROM ingredient_alias
      INNER JOIN ingredient ON ingredient.id = ingredient_alias.ingredient_id
      WHERE ingredient.owner_tenant_id IS NULL
      ORDER BY ingredient_alias.alias`);
    return reply.send({
      ingredients: ingredients.rows.map((ingredient: IngredientRow): object => ({
        publicId: ingredient.public_id,
        canonicalName: ingredient.canonical_name,
        localizationKey: ingredient.localization_key,
        usageCount: ingredient.usage_count,
        aliases: aliases.rows
          .filter((alias: AliasRow): boolean => alias.ingredient_public_id === ingredient.public_id)
          .map(aliasResponse),
      })),
    });
  });

  api.post('/admin/ingredients', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const canonicalName = nameFrom(request.body, 'canonicalName');
    if (canonicalName === null) return invalidIngredient(reply);
    try {
      const result = await pool.query<IngredientRow>(
        `INSERT INTO ingredient (canonical_name) VALUES ($1)
         RETURNING public_id, canonical_name, localization_key, 0::integer AS usage_count`,
        [canonicalName],
      );
      return reply.code(201).send({ ...ingredientResponse(result.rows[0]!), aliases: [] });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return ingredientConflict(reply);
      throw error;
    }
  });

  api.patch(
    '/admin/ingredients/:publicId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const canonicalName = nameFrom(request.body, 'canonicalName');
      if (canonicalName === null) return invalidIngredient(reply);
      const result = await pool.query(
        `UPDATE ingredient SET canonical_name = $1
       WHERE public_id = $2 AND owner_tenant_id IS NULL`,
        [canonicalName, (request.params as { publicId: string }).publicId],
      );
      if (result.rowCount === 1) return reply.code(204).send();
      return reply
        .code(404)
        .send({ code: 'INGREDIENT_NOT_FOUND', error: 'The ingredient was not found.' });
    },
  );

  api.delete(
    '/admin/ingredients/:publicId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const publicId = (request.params as { publicId: string }).publicId;
      const result = await pool.query(
        `DELETE FROM ingredient
       WHERE public_id = $1 AND owner_tenant_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM ingredient_usage WHERE ingredient_usage.ingredient_id = ingredient.id)`,
        [publicId],
      );
      if (result.rowCount === 1) return reply.code(204).send();
      const exists = await pool.query(
        'SELECT EXISTS (SELECT 1 FROM ingredient WHERE public_id = $1 AND owner_tenant_id IS NULL) AS exists',
        [publicId],
      );
      if (exists.rows[0]?.exists === true)
        return reply.code(409).send({
          code: 'INGREDIENT_IN_USE',
          error: 'The ingredient is used by recipes and cannot be deleted.',
        });
      return reply
        .code(404)
        .send({ code: 'INGREDIENT_NOT_FOUND', error: 'The ingredient was not found.' });
    },
  );

  api.post(
    '/admin/ingredients/:publicId/aliases',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const alias = nameFrom(request.body, 'alias');
      if (alias === null) return invalidAlias(reply);
      try {
        const result = await pool.query<AliasRow>(
          `INSERT INTO ingredient_alias (ingredient_id, alias)
           SELECT id, $1 FROM ingredient WHERE public_id = $2 AND owner_tenant_id IS NULL
           RETURNING (SELECT public_id FROM ingredient WHERE ingredient.id = ingredient_alias.ingredient_id) AS ingredient_public_id,
             public_id, alias, localization_key`,
          [alias, (request.params as { publicId: string }).publicId],
        );
        if (result.rowCount !== 1)
          return reply
            .code(404)
            .send({ code: 'INGREDIENT_NOT_FOUND', error: 'The ingredient was not found.' });
        return reply.code(201).send(aliasResponse(result.rows[0]!));
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return aliasConflict(reply);
        throw error;
      }
    },
  );

  api.patch(
    '/admin/ingredients/:publicId/aliases/:aliasPublicId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const alias = nameFrom(request.body, 'alias');
      if (alias === null) return invalidAlias(reply);
      try {
        const result = await pool.query(
          `UPDATE ingredient_alias SET alias = $1
           FROM ingredient
           WHERE ingredient_alias.ingredient_id = ingredient.id
             AND ingredient.public_id = $2 AND ingredient.owner_tenant_id IS NULL
             AND ingredient_alias.public_id = $3`,
          [
            alias,
            (request.params as { publicId: string }).publicId,
            (request.params as { aliasPublicId: string }).aliasPublicId,
          ],
        );
        if (result.rowCount === 1) return reply.code(204).send();
        return reply.code(404).send({ code: 'ALIAS_NOT_FOUND', error: 'The alias was not found.' });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return aliasConflict(reply);
        throw error;
      }
    },
  );

  api.delete(
    '/admin/ingredients/:publicId/aliases/:aliasPublicId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const result = await pool.query(
        `DELETE FROM ingredient_alias USING ingredient
         WHERE ingredient_alias.ingredient_id = ingredient.id
           AND ingredient.public_id = $1 AND ingredient.owner_tenant_id IS NULL
           AND ingredient_alias.public_id = $2`,
        [
          (request.params as { publicId: string }).publicId,
          (request.params as { aliasPublicId: string }).aliasPublicId,
        ],
      );
      return result.rowCount === 1
        ? reply.code(204).send()
        : reply.code(404).send({ code: 'ALIAS_NOT_FOUND', error: 'The alias was not found.' });
    },
  );
}

function nameFrom(value: unknown, property: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = (value as Record<string, unknown>)[property];
  if (typeof candidate !== 'string') return null;
  const name = candidate.trim();
  return name.length > 0 && name.length <= 160 ? name : null;
}

function ingredientResponse(ingredient: IngredientRow): object {
  return {
    publicId: ingredient.public_id,
    canonicalName: ingredient.canonical_name,
    localizationKey: ingredient.localization_key,
    usageCount: ingredient.usage_count,
  };
}

function aliasResponse(alias: AliasRow): object {
  return { publicId: alias.public_id, alias: alias.alias, localizationKey: alias.localization_key };
}

function invalidIngredient(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_INGREDIENT', error: 'The ingredient is invalid.' });
}

function ingredientConflict(reply: FastifyReply): FastifyReply {
  return reply.code(409).send({
    code: 'INGREDIENT_CONFLICT',
    error: 'The ingredient name is already in use.',
  });
}

function invalidAlias(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_ALIAS', error: 'The alias is invalid.' });
}

function aliasConflict(reply: FastifyReply): FastifyReply {
  return reply.code(409).send({ code: 'ALIAS_CONFLICT', error: 'The alias is already in use.' });
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
