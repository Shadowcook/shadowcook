import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { sendTemplatedInstanceMail } from '../mail/service.js';
import {
  EmailChangeError,
  hashEmailChangeToken,
  loadEmailChangeVerification,
  type StoredEmailChangeVerification,
} from './email-change-verification.js';

const linkLifetimeSeconds: number = 24 * 60 * 60;

interface PendingEmailChange {
  new_email: string;
  expires_at: Date;
  last_sent_at: Date;
  send_count: number;
}

interface LockedAccount {
  email: string;
  display_name: string;
  now: Date;
}

interface EmailChangeStatusRow extends LockedAccount {
  new_email: string | null;
  expires_at: Date | null;
  last_sent_at: Date | null;
  send_count: number | null;
}

export interface EmailChangeStatus {
  email: string;
  pending: { email: string; expiresAt: string } | null;
  nextResendAt: string | null;
  serverTime: string;
}

export function emailChangeCooldownSeconds(sendCount: number): number {
  if (sendCount <= 1) return 60;
  if (sendCount === 2) return 180;
  if (sendCount === 3) return 600;
  if (sendCount === 4) return 1800;
  return 3600;
}

function statusFor(
  account: LockedAccount,
  pending: PendingEmailChange | undefined,
): EmailChangeStatus {
  return {
    email: account.email,
    pending:
      pending !== undefined && pending.expires_at > account.now
        ? { email: pending.new_email, expiresAt: pending.expires_at.toISOString() }
        : null,
    nextResendAt:
      pending === undefined
        ? null
        : new Date(
            pending.last_sent_at.getTime() + emailChangeCooldownSeconds(pending.send_count) * 1000,
          ).toISOString(),
    serverTime: account.now.toISOString(),
  };
}

export async function emailChangeStatus(pool: Pool, userId: string): Promise<EmailChangeStatus> {
  const result: QueryResult<EmailChangeStatusRow> = await pool.query<EmailChangeStatusRow>(
    `SELECT user_account.email, user_account.display_name, clock_timestamp() AS now,
       account_email_change.new_email, account_email_change.expires_at,
       account_email_change.last_sent_at, account_email_change.send_count
     FROM user_account LEFT JOIN account_email_change ON account_email_change.user_account_id = user_account.id
     WHERE user_account.id = $1 AND user_account.disabled_at IS NULL AND user_account.deleted_at IS NULL`,
    [userId],
  );
  const row: EmailChangeStatusRow | undefined = result.rows[0];
  if (row === undefined) throw new EmailChangeError('AUTHENTICATION_REQUIRED', 401);
  const pending: PendingEmailChange | undefined =
    row.new_email === null
      ? undefined
      : {
          new_email: row.new_email,
          expires_at: row.expires_at!,
          last_sent_at: row.last_sent_at!,
          send_count: row.send_count!,
        };
  return statusFor(row, pending);
}

export async function sendEmailChange(
  pool: Pool,
  userId: string,
  newEmail: string | null,
  instanceSecretKey: Buffer | null,
  publicWebOrigin: string,
): Promise<EmailChangeStatus> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const accountResult: QueryResult<LockedAccount> = await client.query<LockedAccount>(
      `SELECT email, display_name, clock_timestamp() AS now FROM user_account
       WHERE id = $1 AND disabled_at IS NULL AND deleted_at IS NULL FOR UPDATE`,
      [userId],
    );
    const account: LockedAccount | undefined = accountResult.rows[0];
    if (account === undefined) throw new EmailChangeError('AUTHENTICATION_REQUIRED', 401);
    const pendingResult: QueryResult<PendingEmailChange> = await client.query<PendingEmailChange>(
      'SELECT new_email, expires_at, last_sent_at, send_count FROM account_email_change WHERE user_account_id = $1 FOR UPDATE',
      [userId],
    );
    const previous: PendingEmailChange | undefined = pendingResult.rows[0];
    const status: EmailChangeStatus = statusFor(account, previous);
    if (status.nextResendAt !== null && new Date(status.nextResendAt) > account.now) {
      const retryAfterSeconds: number = Math.max(
        1,
        Math.ceil((Date.parse(status.nextResendAt) - account.now.getTime()) / 1000),
      );
      throw new EmailChangeError('EMAIL_CHANGE_RATE_LIMITED', 429, retryAfterSeconds);
    }
    if (newEmail === null && status.pending === null)
      throw new EmailChangeError('NO_PENDING_EMAIL_CHANGE', 409);
    const targetEmail: string = newEmail ?? previous!.new_email;
    if (targetEmail === account.email) throw new EmailChangeError('EMAIL_UNCHANGED', 400);
    await requireAvailableEmail(client, targetEmail);
    const token: string = randomBytes(32).toString('base64url');
    const sendCount: number =
      previous === undefined ||
      account.now.getTime() - previous.last_sent_at.getTime() >= linkLifetimeSeconds * 1000
        ? 1
        : previous.send_count + 1;
    const pending: PendingEmailChange = {
      new_email: targetEmail,
      last_sent_at: account.now,
      expires_at: new Date(account.now.getTime() + linkLifetimeSeconds * 1000),
      send_count: sendCount,
    };
    await client.query(
      `INSERT INTO account_email_change (user_account_id, new_email, token_hash, expires_at, last_sent_at, send_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_account_id) DO UPDATE SET new_email = EXCLUDED.new_email,
         token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
         last_sent_at = EXCLUDED.last_sent_at, send_count = EXCLUDED.send_count`,
      [
        userId,
        targetEmail,
        hashEmailChangeToken(token),
        pending.expires_at,
        pending.last_sent_at,
        sendCount,
      ],
    );
    let delivered: boolean;
    try {
      delivered = await sendTemplatedInstanceMail(
        client,
        instanceSecretKey,
        targetEmail,
        'EMAIL_CHANGE_VERIFICATION',
        {
          recipient_name: account.display_name,
          action_url: `${publicWebOrigin}/settings/email/verify/${token}`,
          expires_in: '24 hours',
        },
      );
    } catch (_error: unknown) {
      throw new EmailChangeError('EMAIL_CHANGE_DELIVERY_FAILED', 502);
    }
    if (!delivered) throw new EmailChangeError('SMTP_REQUIRED', 503);
    await client.query('COMMIT');
    return statusFor(account, pending);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyEmailChange(
  pool: Pool,
  token: string,
  sessionToken: string | null,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const initial: StoredEmailChangeVerification = await loadEmailChangeVerification(
      client,
      token,
      sessionToken,
    );
    const userId: string = initial.userAccountId;
    const accountResult: QueryResult<LockedAccount> = await client.query<LockedAccount>(
      `SELECT email, display_name, clock_timestamp() AS now FROM user_account
       WHERE id = $1 AND disabled_at IS NULL AND deleted_at IS NULL FOR UPDATE`,
      [userId],
    );
    const account: LockedAccount | undefined = accountResult.rows[0];
    if (account === undefined) throw new EmailChangeError('INVALID_EMAIL_CHANGE_TOKEN', 400);
    const verification: StoredEmailChangeVerification = await loadEmailChangeVerification(
      client,
      token,
      sessionToken,
      true,
    );
    if (verification.reauthenticationRequired)
      throw new EmailChangeError('REAUTHENTICATION_REQUIRED', 403);
    await requireAvailableEmail(client, verification.email);
    await client.query('UPDATE user_account SET email = $1, updated_at = now() WHERE id = $2', [
      verification.email,
      userId,
    ]);
    await client.query('DELETE FROM account_email_change WHERE user_account_id = $1', [userId]);
    await client.query(
      'UPDATE password_reset_token SET consumed_at = now() WHERE user_account_id = $1 AND consumed_at IS NULL',
      [userId],
    );
    await client.query(
      "UPDATE email_one_time_code SET consumed_at = now() WHERE normalized_email IN ($1, $2) AND purpose = 'LOGIN' AND consumed_at IS NULL",
      [account.email, verification.email],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      throw new EmailChangeError('EMAIL_UNAVAILABLE', 409);
    throw error;
  } finally {
    client.release();
  }
}

async function requireAvailableEmail(client: PoolClient, email: string): Promise<void> {
  const result: QueryResult<{ exists: boolean }> = await client.query(
    'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
    [email],
  );
  if (result.rows[0]?.exists === true) throw new EmailChangeError('EMAIL_UNAVAILABLE', 409);
}
