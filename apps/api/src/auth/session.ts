import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

export interface AuthenticatedSessionUser {
  id: string;
  principal_id: string;
  email: string;
  password_hash: string | null;
  password_change_required: boolean;
  disabled_at: Date | null;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function sessionTokenFromRequest(request: FastifyRequest): string | null {
  const cookieHeader: string | undefined = request.headers.cookie;
  if (cookieHeader === undefined) return null;

  const parts: string[] = cookieHeader.split(';');
  for (const part of parts) {
    const [name, value]: string[] = part.trim().split('=', 2);
    if (name === 'shadowcook_session' && value !== undefined) return value;
  }
  return null;
}

export async function currentSessionUser(
  pool: Pool,
  request: FastifyRequest,
): Promise<AuthenticatedSessionUser | null> {
  const token: string | null = sessionTokenFromRequest(request);
  if (token === null) return null;

  const result = await pool.query<AuthenticatedSessionUser>(
    `
    SELECT user_account.id, user_account.principal_id, user_account.email, user_account.password_hash,
      user_account.password_change_required, user_account.disabled_at
    FROM user_session
    INNER JOIN user_account ON user_account.id = user_session.user_account_id
    WHERE user_session.token_hash = $1 AND user_session.revoked_at IS NULL AND user_session.expires_at > now()
  `,
    [hashSessionToken(token)],
  );
  return result.rows[0] ?? null;
}
