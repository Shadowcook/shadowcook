import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { currentSessionUser } from './session.js';

export interface AuthenticatedPrincipal {
  principal_id: string;
  principal_type: 'USER' | 'SERVICE_ACCOUNT';
  disabled_at: Date | null;
}

interface ApiTokenPrincipalRow extends AuthenticatedPrincipal {
  token_id: string;
}

export async function currentAuthenticatedPrincipal(
  pool: Pool,
  request: FastifyRequest,
): Promise<AuthenticatedPrincipal | null> {
  const bearerToken: string | null = bearerTokenFromRequest(request);
  if (bearerToken !== null) return currentApiTokenPrincipal(pool, bearerToken);

  const user = await currentSessionUser(pool, request);
  if (user === null) return null;
  return { principal_id: user.principal_id, principal_type: 'USER', disabled_at: user.disabled_at };
}

function bearerTokenFromRequest(request: FastifyRequest): string | null {
  const authorization: string | undefined = request.headers.authorization;
  if (authorization === undefined) return null;
  const match: RegExpMatchArray | null = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

async function currentApiTokenPrincipal(
  pool: Pool,
  token: string,
): Promise<AuthenticatedPrincipal | null> {
  const result = await pool.query<ApiTokenPrincipalRow>(
    `SELECT principal.id AS principal_id, principal.principal_type, principal.disabled_at, api_token.id AS token_id
     FROM api_token
     INNER JOIN service_account ON service_account.id = api_token.service_account_id
     INNER JOIN principal ON principal.id = service_account.principal_id
     WHERE api_token.token_hash = $1
       AND api_token.revoked_at IS NULL
       AND (api_token.expires_at IS NULL OR api_token.expires_at > now())
       AND service_account.disabled_at IS NULL
       AND principal.disabled_at IS NULL`,
    [createHash('sha256').update(token, 'utf8').digest()],
  );
  const principal: ApiTokenPrincipalRow | undefined = result.rows[0];
  if (principal === undefined) return null;
  await pool.query('UPDATE api_token SET last_used_at = now() WHERE id = $1', [principal.token_id]);
  return principal;
}
