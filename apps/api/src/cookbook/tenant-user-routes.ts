import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

interface TenantUserRoleBody {
  roleIds: string[];
}

interface TenantUserQuery {
  tenantSlug?: unknown;
}

export function registerTenantUserRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenant-users', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantSlug: string | null = tenantSlugFromRequest(request);
    if (tenantSlug === null)
      return reply.code(400).send({ code: 'INVALID_TENANT', error: 'A tenant is required.' });
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'tenant:manage',
    );
    if (tenantId === null) return;
    const [users, roles] = await Promise.all([
      pool.query(
        `SELECT user_account.public_id, user_account.email, user_account.display_name,
          COALESCE((SELECT json_agg(json_build_object('id', tenant_role.id, 'name', tenant_role.name) ORDER BY tenant_role.name)
            FROM tenant_membership_role
            INNER JOIN tenant_role ON tenant_role.id = tenant_membership_role.tenant_role_id
            WHERE tenant_membership_role.tenant_id = $1
              AND tenant_membership_role.principal_id = user_account.principal_id), '[]') AS roles
         FROM tenant_membership
         INNER JOIN user_account ON user_account.principal_id = tenant_membership.principal_id
         WHERE tenant_membership.tenant_id = $1 AND user_account.deleted_at IS NULL
         ORDER BY user_account.display_name, user_account.email`,
        [tenantId],
      ),
      pool.query<{ id: string; name: string }>(
        "SELECT id, name FROM tenant_role WHERE tenant_id = $1 AND name IN ('Editor', 'Viewer') ORDER BY name",
        [tenantId],
      ),
    ]);
    return reply.send({ users: users.rows, roles: roles.rows });
  });

  api.put(
    '/cookbook/tenant-users/:publicId/roles',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantSlug: string | null = tenantSlugFromRequest(request);
      const body: TenantUserRoleBody | null = parseTenantUserRoleBody(request.body);
      if (tenantSlug === null || body === null)
        return reply.code(400).send({
          code: 'INVALID_TENANT_ROLE_ASSIGNMENT',
          error: 'The role assignment is invalid.',
        });
      const tenantId: string | null = await requireTenantPermission(
        pool,
        request,
        reply,
        tenantSlug,
        'tenant:manage',
      );
      if (tenantId === null) return;
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const user = await client.query<{ principal_id: string }>(
          `SELECT user_account.principal_id FROM tenant_membership
           INNER JOIN user_account ON user_account.principal_id = tenant_membership.principal_id
           WHERE tenant_membership.tenant_id = $1 AND user_account.public_id = $2
             AND user_account.deleted_at IS NULL FOR UPDATE`,
          [tenantId, (request.params as { publicId: string }).publicId],
        );
        if (user.rows[0] === undefined) {
          await client.query('ROLLBACK');
          return reply
            .code(404)
            .send({ code: 'TENANT_USER_NOT_FOUND', error: 'The tenant user was not found.' });
        }
        const owner = await client.query<{ owner_principal_id: string | null }>(
          'SELECT owner_principal_id FROM tenant WHERE id = $1 FOR UPDATE',
          [tenantId],
        );
        if (owner.rows[0]?.owner_principal_id === user.rows[0].principal_id) {
          await client.query('ROLLBACK');
          return reply.code(403).send({
            code: 'OWNER_ROLE_PROTECTED',
            error: 'The cookbook owner role cannot be changed.',
          });
        }
        const roles = await client.query<{ id: string }>(
          "SELECT id FROM tenant_role WHERE tenant_id = $1 AND name IN ('Editor', 'Viewer') AND id = ANY($2::uuid[])",
          [tenantId, body.roleIds],
        );
        if (roles.rowCount !== body.roleIds.length) {
          await client.query('ROLLBACK');
          return reply.code(400).send({
            code: 'INVALID_TENANT_ROLE_ASSIGNMENT',
            error: 'The role assignment is invalid.',
          });
        }
        await client.query(
          'DELETE FROM tenant_membership_role WHERE tenant_id = $1 AND principal_id = $2',
          [tenantId, user.rows[0].principal_id],
        );
        await client.query(
          'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) SELECT $1, $2, unnest($3::uuid[])',
          [tenantId, user.rows[0].principal_id, body.roleIds],
        );
        await client.query('COMMIT');
        return reply.code(204).send();
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}

function tenantSlugFromRequest(request: FastifyRequest): string | null {
  const tenantSlug: unknown = (request.query as TenantUserQuery).tenantSlug;
  return typeof tenantSlug === 'string' && tenantSlug.length > 0 ? tenantSlug : null;
}

function parseTenantUserRoleBody(value: unknown): TenantUserRoleBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const roleIds: unknown = (value as Record<string, unknown>).roleIds;
  if (
    !Array.isArray(roleIds) ||
    roleIds.length === 0 ||
    !roleIds.every((id: unknown): boolean => typeof id === 'string')
  )
    return null;
  const uniqueRoleIds: string[] = [...new Set(roleIds as string[])];
  return uniqueRoleIds.length === roleIds.length ? { roleIds: uniqueRoleIds } : null;
}
