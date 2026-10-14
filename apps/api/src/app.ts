import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { registerAuthenticationRoutes } from './auth/routes.js';
import { registerCookbookRoutes } from './cookbook/routes.js';
import { registerCookbookExportRoutes } from './cookbook/export-routes.js';
import { registerAdminMailRoutes } from './admin/mail-routes.js';
import { registerAdminEmailTemplateRoutes } from './admin/email-template-routes.js';
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
import { registerAccountRoutes } from './account/routes.js';
import { registerEmailChangeRoutes } from './account/email-change-routes.js';
import { registerCookbookSlugRoutes } from './admin/cookbook-slug-routes.js';
import type { RegistrationConfig } from './config.js';
import { registerOAuthRoutes } from './auth/oauth.js';
import { registerMcpRoutes } from './mcp/routes.js';
import { registerReportRoutes } from './reports/routes.js';
import { registerAdminReportRoutes } from './reports/admin-routes.js';

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
  registerOAuthRoutes(api, pool, publicWebOrigin, publicApiOrigin);
  registerAuthenticationRoutes(api, pool, secureCookies, instanceSecretKey, publicWebOrigin);
  registerAccountRoutes(api, pool);
  registerReportRoutes(api, pool, instanceSecretKey, publicWebOrigin);
  registerAdminReportRoutes(api, pool);
  registerEmailChangeRoutes(api, pool, instanceSecretKey, publicWebOrigin);
  registerPublicRegistrationRoutes(
    api,
    pool,
    instanceSecretKey,
    publicWebOrigin,
    registrationConfig,
  );
  registerRegistrationSettingsRoutes(api, pool, registrationConfig);
  registerCookbookSlugRoutes(api, pool);
  registerCookbookRoutes(api, pool);
  registerCookbookExportRoutes(api, pool);
  registerCategoryRoutes(api, pool);
  registerRecipeEditorRoutes(api, pool);
  registerTenantUserRoutes(api, pool);
  registerTenantIngredientRoutes(api, pool);
  registerTenantUnitRoutes(api, pool);
  registerServiceAccountRoutes(api, pool);
  registerAiContextRoutes(api, pool, publicWebOrigin, publicApiOrigin);
  registerAdminMailRoutes(api, pool, instanceSecretKey);
  registerAdminEmailTemplateRoutes(api, pool);
  registerAuthenticationSettingsRoutes(api, pool, instanceSecretKey);
  registerFrontpageSettingsRoutes(api, pool);
  registerLegalDocumentRoutes(api, pool);
  registerTenantRoutes(api, pool, secureCookies, instanceSecretKey, publicWebOrigin);
  registerUnitRoutes(api, pool);
  registerMcpRoutes(api, pool, publicApiOrigin);
  return api;
}
