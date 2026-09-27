import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { currentSessionUser } from '../auth/session.js';

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
  const user = await currentSessionUser(pool, request);
  if (user === null || user.disabled_at !== null) {
    reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
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
    [user.principal_id, permissionCode],
  );
  if (result.rows[0]?.permitted !== true) {
    reply
      .code(403)
      .send({ code: 'INSTANCE_PERMISSION_REQUIRED', error: 'An instance permission is required.' });
    return null;
  }
  return user.principal_id;
}

export async function requireTenantPermission(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  tenantSlug: string,
  permissionCode: string,
): Promise<string | null> {
  const user = await currentSessionUser(pool, request);
  if (user === null || user.disabled_at !== null) {
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
          AND tenant_role_permission.permission_code = $2
      ) OR EXISTS (
        SELECT 1
        FROM principal_instance_role
        INNER JOIN instance_role_permission
          ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
        WHERE principal_instance_role.principal_id = $1
          AND instance_role_permission.permission_code = 'instance:administer'
      ) OR EXISTS (
        SELECT 1
        FROM principal_instance_role
        INNER JOIN instance_role_permission
          ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
        WHERE principal_instance_role.principal_id = $1
          AND $2 = 'tenant:manage'
          AND instance_role_permission.permission_code = 'tenant:create'
      ) AS permitted
      FROM tenant
      WHERE tenant.slug = $3 AND tenant.disabled_at IS NULL
    `,
    [user.principal_id, permissionCode, tenantSlug],
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
