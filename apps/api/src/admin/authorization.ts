import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { hashSessionToken, sessionTokenFromRequest } from '../auth/session.js';
import { currentAuthenticatedPrincipal } from '../auth/principal.js';

interface PermissionRow {
  permitted: boolean;
}

interface TenantPermissionRow {
  id: string;
  permitted: boolean;
}

export async function requireInstancePermission(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  permissionCode: string,
): Promise<string | null> {
  const principal = await currentAuthenticatedPrincipal(pool, request);
  if (principal === null || principal.disabled_at !== null) {
    reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    return null;
  }
  if (principal.principal_type !== 'USER') {
    reply
      .code(403)
      .send({ code: 'INSTANCE_PERMISSION_REQUIRED', error: 'An instance permission is required.' });
    return null;
  }
  const result = await pool.query<PermissionRow>(
    `
    SELECT EXISTS (
      SELECT 1 FROM principal_instance_role
      INNER JOIN instance_role_permission ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
      WHERE principal_instance_role.principal_id = $1 AND instance_role_permission.permission_code IN ($2, 'instance:administer')
    ) AS permitted
  `,
    [principal.principal_id, permissionCode],
  );
  if (result.rows[0]?.permitted !== true) {
    reply
      .code(403)
      .send({ code: 'INSTANCE_PERMISSION_REQUIRED', error: 'An instance permission is required.' });
    return null;
  }
  return principal.principal_id;
}

export async function requireTenantPermission(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  tenantSlug: string,
  permissionCode: string,
): Promise<string | null> {
  return requireTenantAnyPermission(pool, request, reply, tenantSlug, [permissionCode]);
}

export async function requireTenantAnyPermission(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  tenantSlug: string,
  permissionCodes: readonly string[],
): Promise<string | null> {
  const principal = await currentAuthenticatedPrincipal(pool, request);
  if (principal === null || principal.disabled_at !== null) {
    reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    return null;
  }
  const result = await pool.query<TenantPermissionRow>(
    `
      SELECT tenant.id, EXISTS (
        SELECT 1
        FROM tenant_membership_role
        INNER JOIN tenant_role_permission
          ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
        WHERE tenant_membership_role.tenant_id = tenant.id
          AND tenant_membership_role.principal_id = $1
          AND tenant_role_permission.permission_code = ANY($2::text[])
      ) AS permitted
      FROM tenant
      WHERE tenant.slug = $3 AND tenant.disabled_at IS NULL AND NOT tenant.name_reset_required
    `,
    [principal.principal_id, permissionCodes, tenantSlug],
  );
  const tenant: TenantPermissionRow | undefined = result.rows[0];
  if (tenant === undefined) {
    reply.code(404).send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
    return null;
  }
  if (!tenant.permitted) {
    reply
      .code(403)
      .send({ code: 'TENANT_PERMISSION_REQUIRED', error: 'A tenant permission is required.' });
    return null;
  }
  return tenant.id;
}

interface AdministrativeActorRow {
  principal_id: string;
  password_change_required: boolean;
  permitted: boolean;
  identity_reset_required: boolean;
}

/** Sensitive administration is deliberately separate from ordinary instance/tenant guards. */
export async function requireAdministrativeActor(
  database: Pool | PoolClient,
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  lockRows: boolean = true,
): Promise<string | null> {
  const deny: (status: number, code: string) => null = (status: number, code: string): null => {
    request.log.warn(
      { action, requestId: request.id, outcome: 'DENIED', code },
      'Administrative operation denied',
    );
    reply.code(status).send({ code, error: 'Administrative authorization is required.' });
    return null;
  };
  // Even a valid session cannot turn a recipe-scoped bearer request into administration.
  if (request.headers.authorization !== undefined) return deny(403, 'ADMIN_SESSION_REQUIRED');
  const token: string | null = sessionTokenFromRequest(request);
  if (token === null) return deny(401, 'AUTHENTICATION_REQUIRED');
  const result: QueryResult<AdministrativeActorRow> = await database.query<AdministrativeActorRow>(
    `SELECT principal.id AS principal_id, account.password_change_required,
      EXISTS (SELECT 1 FROM principal_instance_role role
        JOIN instance_role_permission permission ON permission.instance_role_id = role.instance_role_id
        WHERE role.principal_id = principal.id AND permission.permission_code = 'instance:administer') AS permitted,
      EXISTS (SELECT 1 FROM tenant WHERE owner_principal_id = principal.id AND name_reset_required) AS identity_reset_required
    FROM user_session session
    JOIN user_account account ON account.id = session.user_account_id
    JOIN principal ON principal.id = account.principal_id
    WHERE session.token_hash = $1 AND session.revoked_at IS NULL AND session.expires_at > now()
      AND account.disabled_at IS NULL AND account.deleted_at IS NULL
      AND principal.disabled_at IS NULL AND principal.principal_type = 'USER'
    ${lockRows ? 'FOR SHARE OF session, account, principal' : ''}`,
    [hashSessionToken(token)],
  );
  const actor: AdministrativeActorRow | undefined = result.rows[0];
  if (actor === undefined) return deny(401, 'AUTHENTICATION_REQUIRED');
  if (actor.password_change_required) return deny(403, 'PASSWORD_CHANGE_REQUIRED');
  if (!actor.permitted) return deny(403, 'INSTANCE_PERMISSION_REQUIRED');
  if (actor.identity_reset_required) return deny(403, 'COOKBOOK_NAME_RESET_REQUIRED');
  return actor.principal_id;
}
