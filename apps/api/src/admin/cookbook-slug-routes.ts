import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { normalizeCookbookSlug, reservedCookbookSlugs } from '../cookbook/slug-policy.js';
import { requireInstancePermission } from './authorization.js';

interface CreateBlockedTermBody {
  term: string;
}

export function registerCookbookSlugRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/cookbook-slug-blocked-terms', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const result = await pool.query<{ term: string }>(
      'SELECT term FROM instance_cookbook_slug_blocked_term ORDER BY term',
    );
    return reply.send({ terms: result.rows.map((row: { term: string }): string => row.term) });
  });

  api.post(
    '/admin/cookbook-slug-blocked-terms',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const principalId: string | null = await requireInstancePermission(
        pool,
        request,
        reply,
        'instance:administer',
      );
      if (principalId === null) return;
      const body: CreateBlockedTermBody | null = parseCreateBlockedTerm(request.body);
      const term: string | null = body === null ? null : normalizeCookbookSlug(body.term);
      if (term === null || reservedCookbookSlugs.has(term))
        return reply.code(400).send({
          code: 'INVALID_COOKBOOK_SLUG_BLOCKED_TERM',
          error: 'The blocked term is invalid.',
        });
      try {
        await pool.query(
          'INSERT INTO instance_cookbook_slug_blocked_term (term, created_by_principal_id) VALUES ($1, $2)',
          [term, principalId],
        );
        return reply.code(201).send({ term });
      } catch (error: unknown) {
        if (isUniqueViolation(error))
          return reply.code(409).send({
            code: 'COOKBOOK_SLUG_BLOCKED_TERM_CONFLICT',
            error: 'That blocked term already exists.',
          });
        throw error;
      }
    },
  );

  api.delete(
    '/admin/cookbook-slug-blocked-terms/:term',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const term: string | null = normalizeCookbookSlug((request.params as { term: string }).term);
      if (term === null)
        return reply.code(404).send({
          code: 'COOKBOOK_SLUG_BLOCKED_TERM_NOT_FOUND',
          error: 'The blocked term was not found.',
        });
      const result = await pool.query(
        'DELETE FROM instance_cookbook_slug_blocked_term WHERE term = $1',
        [term],
      );
      return result.rowCount === 1
        ? reply.code(204).send()
        : reply.code(404).send({
            code: 'COOKBOOK_SLUG_BLOCKED_TERM_NOT_FOUND',
            error: 'The blocked term was not found.',
          });
    },
  );
}

function parseCreateBlockedTerm(value: unknown): CreateBlockedTermBody | null {
  if (typeof value !== 'object' || value === null || !('term' in value)) return null;
  const term: unknown = value.term;
  return typeof term === 'string' && term.length <= 64 ? { term } : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
