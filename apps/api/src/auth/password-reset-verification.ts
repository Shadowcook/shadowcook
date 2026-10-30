import type { Pool, PoolClient, QueryResult } from 'pg';
import { createHash } from 'node:crypto';

export function hashPasswordResetToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export class PasswordResetAccountMismatchError extends Error {
  public constructor() {
    super('The active session belongs to another account.');
  }
}

export interface PasswordResetRecord {
  id: string;
  user_account_id: string;
  expires_at: Date;
}

export async function loadPasswordReset(
  database: Pool | PoolClient,
  token: string,
  signedInUserId: string | null,
  lock: boolean = false,
): Promise<PasswordResetRecord | null> {
  const result: QueryResult<PasswordResetRecord> = await database.query<PasswordResetRecord>(
    `SELECT password_reset_token.id, password_reset_token.user_account_id, password_reset_token.expires_at
     FROM password_reset_token INNER JOIN user_account ON user_account.id = password_reset_token.user_account_id
     WHERE password_reset_token.token_hash = $1 AND password_reset_token.consumed_at IS NULL
       AND password_reset_token.expires_at > clock_timestamp()
       AND user_account.disabled_at IS NULL AND user_account.deleted_at IS NULL
     ${lock ? 'FOR UPDATE OF password_reset_token, user_account' : ''}`,
    [hashPasswordResetToken(token)],
  );
  const record: PasswordResetRecord | undefined = result.rows[0];
  if (record === undefined) return null;
  if (signedInUserId !== null && signedInUserId !== record.user_account_id)
    throw new PasswordResetAccountMismatchError();
  return record;
}
