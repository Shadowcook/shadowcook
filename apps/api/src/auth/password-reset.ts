import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hashPassword } from './password.js';

const resetLifetimeMilliseconds: number = 60 * 60 * 1000;

export function hashPasswordResetToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
export async function createPasswordResetToken(
  pool: Pool,
  userAccountId: string,
  forcePasswordChange: boolean,
): Promise<string> {
  const token: string = randomBytes(32).toString('base64url');
  await pool.query(
    'UPDATE password_reset_token SET consumed_at = now() WHERE user_account_id = $1 AND consumed_at IS NULL',
    [userAccountId],
  );
  await pool.query(
    'INSERT INTO password_reset_token (user_account_id, token_hash, force_password_change, expires_at) VALUES ($1, $2, $3, $4)',
    [
      userAccountId,
      hashPasswordResetToken(token),
      forcePasswordChange,
      new Date(Date.now() + resetLifetimeMilliseconds),
    ],
  );
  return token;
}
export async function completePasswordReset(
  pool: Pool,
  token: string,
  newPassword: string,
  minimumEntropy: number,
): Promise<boolean> {
  const passwordHash: string = await hashPassword(newPassword, minimumEntropy);
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const reset = await client.query<{ id: string; user_account_id: string }>(
      `SELECT password_reset_token.id, password_reset_token.user_account_id
       FROM password_reset_token
       INNER JOIN user_account ON user_account.id = password_reset_token.user_account_id
       WHERE password_reset_token.token_hash = $1
         AND password_reset_token.consumed_at IS NULL
         AND password_reset_token.expires_at > now()
         AND user_account.deleted_at IS NULL
       FOR UPDATE`,
      [hashPasswordResetToken(token)],
    );
    const record: { id: string; user_account_id: string } | undefined = reset.rows[0];
    if (record === undefined) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      'UPDATE user_account SET password_hash = $1, password_change_required = false, password_changed_at = now(), updated_at = now() WHERE id = $2',
      [passwordHash, record.user_account_id],
    );
    await client.query('UPDATE password_reset_token SET consumed_at = now() WHERE id = $1', [
      record.id,
    ]);
    await client.query(
      'UPDATE user_session SET revoked_at = now() WHERE user_account_id = $1 AND revoked_at IS NULL',
      [record.user_account_id],
    );
    await client.query('COMMIT');
    return true;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
