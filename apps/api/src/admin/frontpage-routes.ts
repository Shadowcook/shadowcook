import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';

const defaultSiteName: string = 'My Cookbook';
const defaultSlogan: string = 'Made to be shared';
const defaultCookbooksPerPage: number = 4;

interface FrontpageSettingsRow {
  site_name: string;
  slogan: string;
  cookbooks_per_page: number;
}

export function registerFrontpageSettingsRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/frontpage-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const result = await pool.query<FrontpageSettingsRow>(
      'SELECT site_name, slogan, cookbooks_per_page FROM instance_frontpage_settings WHERE singleton = true',
    );
    const settings: FrontpageSettingsRow | undefined = result.rows[0];
    return reply.send({
      siteName: settings?.site_name ?? defaultSiteName,
      slogan: settings?.slogan ?? defaultSlogan,
      cookbooksPerPage: settings?.cookbooks_per_page ?? defaultCookbooksPerPage,
    });
  });

  api.put('/admin/frontpage-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:administer',
    );
    if (principalId === null) return;
    const body = request.body as Record<string, unknown>;
    const siteName: unknown = body.siteName;
    const slogan: unknown = body.slogan;
    const cookbooksPerPage: unknown = body.cookbooksPerPage;
    if (
      !isTextSetting(siteName) ||
      !isTextSetting(slogan) ||
      typeof cookbooksPerPage !== 'number' ||
      !Number.isSafeInteger(cookbooksPerPage) ||
      cookbooksPerPage < 1 ||
      cookbooksPerPage > 100
    )
      return reply.code(400).send({
        code: 'INVALID_FRONTPAGE_SETTINGS',
        error: 'The front page settings are invalid.',
      });
    await pool.query(
      `INSERT INTO instance_frontpage_settings
        (singleton, site_name, slogan, cookbooks_per_page, updated_by_principal_id)
       VALUES (true, $1, $2, $3, $4)
       ON CONFLICT (singleton) DO UPDATE SET
         site_name = EXCLUDED.site_name,
         slogan = EXCLUDED.slogan,
         cookbooks_per_page = EXCLUDED.cookbooks_per_page,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id,
         updated_at = now()`,
      [siteName, slogan, cookbooksPerPage, principalId],
    );
    return reply.code(204).send();
  });
}

function isTextSetting(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
}
