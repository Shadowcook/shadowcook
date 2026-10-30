import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { hashSessionToken } from '../auth/session.js';

const recentAuthenticationMilliseconds: number = 5 * 60 * 1000;

export class EmailChangeError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
  }
}

interface VerificationSession {
  user_account_id: string;
  created_at: Date;
  now: Date;
  password_change_required: boolean;
}

interface VerificationRecord {
  user_account_id: string;
  current_email: string;
  new_email: string;
  expires_at: Date;
}

export interface EmailChangeVerification {
  currentEmail: string;
  email: string;
  expiresAt: string;
  reauthenticationRequired: boolean;
}

export interface StoredEmailChangeVerification extends EmailChangeVerification {
  userAccountId: string;
}

export function hashEmailChangeToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export async function loadEmailChangeVerification(
  database: Pool | PoolClient,
  token: string,
  sessionToken: string | null,
  lockPending: boolean = false,
): Promise<StoredEmailChangeVerification> {
  if (sessionToken === null) throw new EmailChangeError('AUTHENTICATION_REQUIRED', 401);
  const sessionResult: QueryResult<VerificationSession> = await database.query<VerificationSession>(
    `SELECT user_session.user_account_id, user_session.created_at, clock_timestamp() AS now,
       user_account.password_change_required
     FROM user_session INNER JOIN user_account ON user_account.id = user_session.user_account_id
     WHERE user_session.token_hash = $1 AND user_session.revoked_at IS NULL
       AND user_session.expires_at > clock_timestamp()
       AND user_account.disabled_at IS NULL AND user_account.deleted_at IS NULL`,
    [hashSessionToken(sessionToken)],
  );
  const session: VerificationSession | undefined = sessionResult.rows[0];
  if (session === undefined) throw new EmailChangeError('AUTHENTICATION_REQUIRED', 401);
  if (session.password_change_required) throw new EmailChangeError('PASSWORD_CHANGE_REQUIRED', 403);
  const pendingResult: QueryResult<VerificationRecord> = await database.query<VerificationRecord>(
    `SELECT account_email_change.user_account_id, account_email_change.new_email,
       account_email_change.expires_at, user_account.email AS current_email
     FROM account_email_change INNER JOIN user_account ON user_account.id = account_email_change.user_account_id
     WHERE account_email_change.token_hash = $1 AND account_email_change.expires_at > clock_timestamp()
       AND user_account.disabled_at IS NULL AND user_account.deleted_at IS NULL
     ${lockPending ? 'FOR UPDATE OF account_email_change' : ''}`,
    [hashEmailChangeToken(token)],
  );
  const pending: VerificationRecord | undefined = pendingResult.rows[0];
  if (pending === undefined) throw new EmailChangeError('INVALID_EMAIL_CHANGE_TOKEN', 400);
  if (pending.user_account_id !== session.user_account_id)
    throw new EmailChangeError('EMAIL_CHANGE_ACCOUNT_MISMATCH', 403);
  const sessionAge: number = session.now.getTime() - session.created_at.getTime();
  return {
    userAccountId: pending.user_account_id,
    currentEmail: pending.current_email,
    email: pending.new_email,
    expiresAt: pending.expires_at.toISOString(),
    reauthenticationRequired: sessionAge < 0 || sessionAge > recentAuthenticationMilliseconds,
  };
}
