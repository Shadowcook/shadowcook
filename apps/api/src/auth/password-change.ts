import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { hashPassword, minimumPasswordEntropy, verifyPassword } from './password.js';
import { currentSessionUser, hashSessionToken, type AuthenticatedSessionUser } from './session.js';

export type PasswordChangeResult =
  | { status: 'changed' }
  | { status: 'authentication-failed' }
  | { status: 'invalid-password'; message: string };

export async function changePassword(
  pool: Pool,
  request: FastifyRequest,
  sessionToken: string,
  currentPassword: string | null,
  newPassword: string,
): Promise<PasswordChangeResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const user: AuthenticatedSessionUser | null = await currentSessionUser(client, request, true);
    if (
      user === null ||
      (user.password_hash !== null &&
        (currentPassword === null || !(await verifyPassword(currentPassword, user.password_hash))))
    ) {
      await client.query('ROLLBACK');
      return { status: 'authentication-failed' };
    }

    const minimumEntropy: number = await minimumPasswordEntropy(client);
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(newPassword, minimumEntropy);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      return {
        status: 'invalid-password',
        message: error instanceof Error ? error.message : 'Invalid password.',
      };
    }
    await client.query(
      `UPDATE user_account
       SET password_hash = $1, password_change_required = false,
         password_changed_at = now(), updated_at = now()
       WHERE id = $2`,
      [passwordHash, user.id],
    );
    await client.query(
      `UPDATE user_session SET revoked_at = now()
       WHERE user_account_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`,
      [user.id, hashSessionToken(sessionToken)],
    );
    await client.query('COMMIT');
    return { status: 'changed' };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
