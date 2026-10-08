import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { registerAuthenticationRoutes } from './auth/routes.js';
import { registerCookbookRoutes } from './cookbook/routes.js';
import { registerAdminMailRoutes } from './admin/mail-routes.js';
import { registerAuthenticationSettingsRoutes } from './admin/authentication-routes.js';
import { registerFrontpageSettingsRoutes } from './admin/frontpage-routes.js';
import { registerLegalDocumentRoutes } from './admin/legal-document-routes.js';
import { registerTenantRoutes } from './admin/tenant-routes.js';
import { registerUnitRoutes } from './admin/unit-routes.js';
import { registerCategoryRoutes } from './cookbook/category-routes.js';
import { registerRecipeEditorRoutes } from './cookbook/recipe-editor-routes.js';
import { registerTenantUserRoutes } from './cookbook/tenant-user-routes.js';
import { registerTenantIngredientRoutes } from './cookbook/ingredient-routes.js';
import { registerTenantUnitRoutes } from './cookbook/unit-routes.js';
import { registerServiceAccountRoutes } from './cookbook/service-account-routes.js';
import { registerAiContextRoutes } from './cookbook/ai-context-routes.js';
import { registerPublicRegistrationRoutes } from './registration/routes.js';
import { registerRegistrationSettingsRoutes } from './admin/registration-settings-routes.js';
import type { RegistrationConfig } from './config.js';

export function createApi(
  pool: Pool,
  secureCookies: boolean,
  instanceSecretKey: Buffer | null,
  publicWebOrigin: string,
  publicApiOrigin: string,
  registrationConfig: RegistrationConfig,
): FastifyInstance {
  const api: FastifyInstance = Fastify({
    logger: {
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  api.get('/health', async () => ({ status: 'ok' }));
  registerAuthenticationRoutes(api, pool, secureCookies, instanceSecretKey, publicWebOrigin);
  registerPublicRegistrationRoutes(
    api,
    pool,
    instanceSecretKey,
    publicWebOrigin,
    registrationConfig,
  );
  registerRegistrationSettingsRoutes(api, pool, registrationConfig);
  registerCookbookRoutes(api, pool);
  registerCategoryRoutes(api, pool);
  registerRecipeEditorRoutes(api, pool);
  registerTenantUserRoutes(api, pool);
  registerTenantIngredientRoutes(api, pool);
  registerTenantUnitRoutes(api, pool);
  registerServiceAccountRoutes(api, pool);
  registerAiContextRoutes(api, pool, publicWebOrigin, publicApiOrigin);
  registerAdminMailRoutes(api, pool, instanceSecretKey);
  registerAuthenticationSettingsRoutes(api, pool, instanceSecretKey);
  registerFrontpageSettingsRoutes(api, pool);
  registerLegalDocumentRoutes(api, pool);
  registerTenantRoutes(api, pool, secureCookies, instanceSecretKey, publicWebOrigin);
  registerUnitRoutes(api, pool);
  return api;
}
