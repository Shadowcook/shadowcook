import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hashPassword } from './password.js';
import {
  hashPasswordResetToken,
  loadPasswordReset,
  type PasswordResetRecord,
} from './password-reset-verification.js';

export { hashPasswordResetToken } from './password-reset-verification.js';

const resetLifetimeMilliseconds: number = 60 * 60 * 1000;

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
  signedInUserId: string | null,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const record: PasswordResetRecord | null = await loadPasswordReset(
      client,
      token,
      signedInUserId,
      true,
    );
    if (record === null) {
      await client.query('ROLLBACK');
      return false;
    }
    const passwordHash: string = await hashPassword(newPassword, minimumEntropy);
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
