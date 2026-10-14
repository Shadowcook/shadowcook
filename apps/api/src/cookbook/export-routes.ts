import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';
import { currentSessionUser, type AuthenticatedSessionUser } from '../auth/session.js';
import { loadCookbookExport } from './export-data.js';
import type { CookbookExport } from './export-types.js';
import { createCookbookZip } from './export-zip.js';

export function registerCookbookExportRoutes(api: FastifyInstance, pool: Pool): void {
  api.get(
    '/cookbook/tenants/:tenantSlug/export',
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      reply.header('Cache-Control', 'no-store');
      const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
      if (user?.password_change_required === true) {
        return reply.code(403).send({
          code: 'PASSWORD_CHANGE_REQUIRED',
          error: 'A password change is required before continuing.',
        });
      }
      const { tenantSlug } = request.params as { tenantSlug: string };
      const tenantId: string | null = await requireTenantPermission(
        pool,
        request,
        reply,
        tenantSlug,
        'tenant:manage',
      );
      if (tenantId === null) return reply;
      const data: CookbookExport = await loadCookbookExport(pool, tenantId);
      const archive: Buffer = await createCookbookZip(
        JSON.stringify(data, null, 2),
        new Date(data.exported_at),
      );
      const timestamp: string = data.exported_at.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      return reply
        .type('application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="${data.cookbook.slug}-${timestamp}.shadowcook.zip"`,
        )
        .header('X-Content-Type-Options', 'nosniff')
        .send(archive);
    },
  );
}
