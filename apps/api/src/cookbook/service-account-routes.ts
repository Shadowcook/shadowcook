import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

interface ServiceAccountInput {
  name: string;
  roleIds: string[];
}

interface TokenInput {
  name: string;
  expiresAt: Date | null;
}

export function registerServiceAccountRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/service-accounts', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply);
    if (tenantId === null) return;
    const [accounts, roles] = await Promise.all([
      pool.query(
        `SELECT service_account.public_id, service_account.name, service_account.disabled_at,
          COALESCE((SELECT json_agg(json_build_object('id', tenant_role.id, 'name', tenant_role.name) ORDER BY tenant_role.name)
            FROM tenant_membership_role
            INNER JOIN tenant_role ON tenant_role.id = tenant_membership_role.tenant_role_id
            WHERE tenant_membership_role.tenant_id = service_account.tenant_id
              AND tenant_membership_role.principal_id = service_account.principal_id), '[]') AS roles,
          COALESCE((SELECT json_agg(json_build_object(
            'id', api_token.id, 'name', api_token.name, 'tokenPrefix', api_token.token_prefix,
            'expiresAt', api_token.expires_at, 'lastUsedAt', api_token.last_used_at,
            'revokedAt', api_token.revoked_at, 'createdAt', api_token.created_at) ORDER BY api_token.created_at DESC)
            FROM api_token WHERE api_token.service_account_id = service_account.id), '[]') AS tokens
         FROM service_account
         WHERE service_account.tenant_id = $1
         ORDER BY service_account.name`,
        [tenantId],
      ),
      pool.query<{ id: string; name: string }>(
        'SELECT id, name FROM tenant_role WHERE tenant_id = $1 ORDER BY name',
        [tenantId],
      ),
    ]);
    return reply.send({ serviceAccounts: accounts.rows, roles: roles.rows });
  });

  api.post('/cookbook/tenants/:tenantSlug/service-accounts', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply);
    if (tenantId === null) return;
    const input: ServiceAccountInput | null = parseServiceAccountInput(request.body);
    if (input === null) return invalidServiceAccount(reply);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await validateRoleIds(client, tenantId, input.roleIds);
      const principal = await client.query<{ id: string }>(
        "INSERT INTO principal (principal_type) VALUES ('SERVICE_ACCOUNT') RETURNING id",
      );
      const account = await client.query<{ public_id: string }>(
        'INSERT INTO service_account (principal_id, tenant_id, name) VALUES ($1, $2, $3) RETURNING public_id',
        [principal.rows[0]!.id, tenantId, input.name],
      );
      await client.query(
        'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
        [tenantId, principal.rows[0]!.id],
      );
      await client.query(
        'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) SELECT $1, $2, unnest($3::uuid[])',
        [tenantId, principal.rows[0]!.id, input.roleIds],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ publicId: account.rows[0]!.public_id });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof InvalidServiceAccountInputError) return invalidServiceAccount(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.patch('/cookbook/tenants/:tenantSlug/service-accounts/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply);
    if (tenantId === null) return;
    const input: ServiceAccountInput | null = parseServiceAccountInput(request.body);
    if (input === null) return invalidServiceAccount(reply);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await validateRoleIds(client, tenantId, input.roleIds);
      const account = await client.query<{ principal_id: string }>(
        'UPDATE service_account SET name = $1 WHERE tenant_id = $2 AND public_id = $3 RETURNING principal_id',
        [input.name, tenantId, (request.params as { publicId: string }).publicId],
      );
      if (account.rows[0] === undefined) {
        await client.query('ROLLBACK');
        return serviceAccountNotFound(reply);
      }
      await client.query(
        'DELETE FROM tenant_membership_role WHERE tenant_id = $1 AND principal_id = $2',
        [tenantId, account.rows[0].principal_id],
      );
      await client.query(
        'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) SELECT $1, $2, unnest($3::uuid[])',
        [tenantId, account.rows[0].principal_id, input.roleIds],
      );
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof InvalidServiceAccountInputError) return invalidServiceAccount(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.delete('/cookbook/tenants/:tenantSlug/service-accounts/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply);
    if (tenantId === null) return;
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query<{ id: string; principal_id: string }>(
        'SELECT id, principal_id FROM service_account WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, (request.params as { publicId: string }).publicId],
      );
      if (account.rows[0] === undefined) {
        await client.query('ROLLBACK');
        return serviceAccountNotFound(reply);
      }
      await client.query(
        'UPDATE api_token SET revoked_at = now() WHERE service_account_id = $1 AND revoked_at IS NULL',
        [account.rows[0].id],
      );
      await client.query('UPDATE service_account SET disabled_at = now() WHERE id = $1', [
        account.rows[0].id,
      ]);
      await client.query('UPDATE principal SET disabled_at = now() WHERE id = $1', [
        account.rows[0].principal_id,
      ]);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  api.post(
    '/cookbook/tenants/:tenantSlug/service-accounts/:publicId/tokens',
    async (request, reply) => {
      const tenantId: string | null = await tenantIdFor(pool, request, reply);
      if (tenantId === null) return;
      const input: TokenInput | null = parseTokenInput(request.body);
      if (input === null) return invalidToken(reply);
      const token: string = randomBytes(32).toString('base64url');
      const tokenPrefix: string = token.slice(0, 8);
      try {
        const result = await pool.query<{ id: string }>(
          `INSERT INTO api_token (service_account_id, name, token_prefix, token_hash, expires_at)
         SELECT service_account.id, $1, $2, $3, $4
         FROM service_account WHERE service_account.tenant_id = $5 AND service_account.public_id = $6
         RETURNING id`,
          [
            input.name,
            tokenPrefix,
            createHash('sha256').update(token, 'utf8').digest(),
            input.expiresAt,
            tenantId,
            (request.params as { publicId: string }).publicId,
          ],
        );
        if (result.rows[0] === undefined) return serviceAccountNotFound(reply);
        return reply.code(201).send({ id: result.rows[0].id, token, tokenPrefix });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return invalidToken(reply);
        throw error;
      }
    },
  );

  api.delete(
    '/cookbook/tenants/:tenantSlug/service-accounts/:publicId/tokens/:tokenId',
    async (request, reply) => {
      const tenantId: string | null = await tenantIdFor(pool, request, reply);
      if (tenantId === null) return;
      const parameters = request.params as { publicId: string; tokenId: string };
      const result = await pool.query(
        `UPDATE api_token SET revoked_at = now()
       FROM service_account
       WHERE api_token.service_account_id = service_account.id
         AND service_account.tenant_id = $1 AND service_account.public_id = $2
         AND api_token.id = $3 AND api_token.revoked_at IS NULL`,
        [tenantId, parameters.publicId, parameters.tokenId],
      );
      return result.rowCount === 1
        ? reply.code(204).send()
        : reply
            .code(404)
            .send({ code: 'API_TOKEN_NOT_FOUND', error: 'The API token was not found.' });
    },
  );
}

async function tenantIdFor(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  return requireTenantPermission(
    pool,
    request,
    reply,
    (request.params as { tenantSlug: string }).tenantSlug,
    'service-account:manage',
  );
}

function parseServiceAccountInput(value: unknown): ServiceAccountInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const name: unknown = (value as Record<string, unknown>).name;
  const roleIds: unknown = (value as Record<string, unknown>).roleIds;
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.trim().length > 160 ||
    !Array.isArray(roleIds) ||
    roleIds.length === 0 ||
    !roleIds.every((roleId: unknown): boolean => typeof roleId === 'string')
  )
    return null;
  const uniqueRoleIds: string[] = [...new Set(roleIds as string[])];
  return uniqueRoleIds.length === roleIds.length
    ? { name: name.trim(), roleIds: uniqueRoleIds }
    : null;
}

function parseTokenInput(value: unknown): TokenInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const name: unknown = (value as Record<string, unknown>).name;
  const expiresAt: unknown = (value as Record<string, unknown>).expiresAt;
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 160) return null;
  if (expiresAt === undefined || expiresAt === null) return { name: name.trim(), expiresAt: null };
  if (typeof expiresAt !== 'string') return null;
  const date: Date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) || date <= new Date()
    ? null
    : { name: name.trim(), expiresAt: date };
}

async function validateRoleIds(
  client: PoolClient,
  tenantId: string,
  roleIds: string[],
): Promise<void> {
  const roles = await client.query<{ id: string }>(
    'SELECT id FROM tenant_role WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
    [tenantId, roleIds],
  );
  if (roles.rowCount !== roleIds.length) throw new InvalidServiceAccountInputError();
}

function invalidServiceAccount(reply: FastifyReply): FastifyReply {
  return reply
    .code(400)
    .send({ code: 'INVALID_SERVICE_ACCOUNT', error: 'The service account is invalid.' });
}

function invalidToken(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_API_TOKEN', error: 'The API token is invalid.' });
}

function serviceAccountNotFound(reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .send({ code: 'SERVICE_ACCOUNT_NOT_FOUND', error: 'The service account was not found.' });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

class InvalidServiceAccountInputError extends Error {}
