import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { currentSessionUser } from '../auth/session.js';

interface PermissionRow { permitted: boolean; }

export async function requireInstancePermission(pool: Pool, request: FastifyRequest, reply: FastifyReply, permissionCode: string): Promise<string | null> {
  const user = await currentSessionUser(pool, request);
  if (user === null || user.disabled_at !== null) {
    reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    return null;
  }
  const result = await pool.query<PermissionRow>(`
    SELECT EXISTS (
      SELECT 1 FROM principal_instance_role
      INNER JOIN instance_role_permission ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
      WHERE principal_instance_role.principal_id = $1 AND instance_role_permission.permission_code IN ($2, 'instance:administer')
    ) AS permitted
  `, [user.principal_id, permissionCode]);
  if (result.rows[0]?.permitted !== true) {
    reply.code(403).send({ code: 'INSTANCE_PERMISSION_REQUIRED', error: 'An instance permission is required.' });
    return null;
  }
  return user.principal_id;
}
