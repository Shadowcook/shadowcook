import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { registerAuthenticationRoutes } from './auth/routes.js';
import { registerCookbookRoutes } from './cookbook/routes.js';
import { registerAdminMailRoutes } from './admin/mail-routes.js';
import { registerAuthenticationSettingsRoutes } from './admin/authentication-routes.js';
import { registerTenantRoutes } from './admin/tenant-routes.js';

export function createApi(pool: Pool, secureCookies: boolean, instanceSecretKey: Buffer | null, publicWebOrigin: string): FastifyInstance {
  const api: FastifyInstance = Fastify({
    logger: {
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  api.get('/health', async () => ({ status: 'ok' }));
  registerAuthenticationRoutes(api, pool, secureCookies, instanceSecretKey);
  registerCookbookRoutes(api, pool);
  registerAdminMailRoutes(api, pool, instanceSecretKey);
  registerAuthenticationSettingsRoutes(api, pool, instanceSecretKey);
  registerTenantRoutes(api, pool, instanceSecretKey, publicWebOrigin);

  return api;
}
