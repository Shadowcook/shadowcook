import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { currentSessionUser, type AuthenticatedSessionUser } from '../auth/session.js';
import { cookbookSlugWithSuffix, isValidCookbookName } from '../cookbook/owned-cookbook.js';
import { cookbookSlugIsBlocked, normalizeCookbookSlug } from '../cookbook/slug-policy.js';

export interface CookbookIdentity {
  publicId: string;
  name: string;
  slug: string;
}

export async function pendingCookbookResets(
  pool: Pool,
  principalId: string,
): Promise<CookbookIdentity[]> {
  const result: QueryResult<CookbookIdentity> = await pool.query<CookbookIdentity>(
    'SELECT public_id AS "publicId", display_name AS name, slug FROM tenant WHERE owner_principal_id = $1 AND name_reset_required ORDER BY public_id',
    [principalId],
  );
  return result.rows;
}

export function registerCookbookIdentityRoutes(api: FastifyInstance, pool: Pool): void {
  api.get(
    '/account/cookbooks/:publicId/slug-availability',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
      if (user === null)
        return reply
          .code(401)
          .send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
      reply.header('Cache-Control', 'no-store');
      const publicId: string = (request.params as { publicId: string }).publicId;
      const owned: QueryResult = await pool.query(
        'SELECT 1 FROM tenant WHERE public_id::text = $1 AND owner_principal_id = $2',
        [publicId, user.principal_id],
      );
      if (owned.rowCount !== 1)
        return reply
          .code(404)
          .send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
      const value: unknown = (request.query as { slug?: unknown }).slug;
      const slug: string | null = typeof value === 'string' ? normalizeCookbookSlug(value) : null;
      if (slug === null)
        return reply.code(400).send({ code: 'INVALID_TENANT_SLUG', error: 'The slug is invalid.' });
      const conflict: QueryResult = await pool.query(
        'SELECT 1 FROM tenant WHERE slug = $1 AND public_id::text <> $2',
        [slug, publicId],
      );
      const blocked: boolean = await cookbookSlugIsBlocked(pool, slug);
      return reply.send({
        available: conflict.rowCount === 0 && !blocked,
        suffixRequired: conflict.rowCount !== 0 && !blocked,
      });
    },
  );

  api.patch(
    '/account/cookbooks/:publicId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
      if (user === null)
        return reply
          .code(401)
          .send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
      const body: {
        displayName?: unknown;
        slug?: unknown;
        appendSuffixOnConflict?: unknown;
      } | null = request.body as {
        displayName?: unknown;
        slug?: unknown;
        appendSuffixOnConflict?: unknown;
      } | null;
      if (
        body === null ||
        typeof body !== 'object' ||
        Object.keys(body).some(
          (key: string): boolean =>
            key !== 'displayName' && key !== 'slug' && key !== 'appendSuffixOnConflict',
        ) ||
        (body.appendSuffixOnConflict !== undefined &&
          typeof body.appendSuffixOnConflict !== 'boolean') ||
        typeof body.displayName !== 'string' ||
        !isValidCookbookName(body.displayName)
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_COOKBOOK', error: 'The cookbook name is invalid.' });
      const name: string = body.displayName.trim();
      const slug: string | null =
        typeof body.slug === 'string' ? normalizeCookbookSlug(body.slug) : null;
      if (slug === null || (await cookbookSlugIsBlocked(pool, slug)))
        return reply.code(400).send({ code: 'INVALID_TENANT_SLUG', error: 'The slug is invalid.' });
      let candidateSlug: string = slug;
      for (let attempt: number = 0; attempt < 10; attempt += 1) {
        if (attempt > 0 && (await cookbookSlugIsBlocked(pool, candidateSlug))) {
          candidateSlug = cookbookSlugWithSuffix(slug);
          continue;
        }
        try {
          // The predicate and reset release are atomic with the identity update.
          const result: QueryResult = await pool.query(
            `UPDATE tenant SET display_name = $1, slug = $2, name_reset_required = false, updated_at = now()
         WHERE public_id::text = $3 AND owner_principal_id = $4
           AND (NOT name_reset_required OR (display_name <> $1 AND slug <> $2))`,
            [
              name,
              candidateSlug,
              (request.params as { publicId: string }).publicId,
              user.principal_id,
            ],
          );
          if (result.rowCount === 1) return reply.code(204).send();
          const owned: QueryResult = await pool.query(
            'SELECT 1 FROM tenant WHERE public_id::text = $1 AND owner_principal_id = $2',
            [(request.params as { publicId: string }).publicId, user.principal_id],
          );
          return owned.rowCount === 1
            ? reply.code(400).send({
                code: 'COOKBOOK_NEW_IDENTITY_REQUIRED',
                error: 'Choose a new name and slug.',
              })
            : reply
                .code(404)
                .send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '23505'
          ) {
            if (body.appendSuffixOnConflict === true) {
              candidateSlug = cookbookSlugWithSuffix(slug);
              continue;
            }
            return reply
              .code(409)
              .send({ code: 'TENANT_SLUG_CONFLICT', error: 'The slug is already in use.' });
          }
          throw error;
        }
      }
      return reply
        .code(409)
        .send({ code: 'TENANT_SLUG_CONFLICT', error: 'The slug is already in use.' });
    },
  );
}
