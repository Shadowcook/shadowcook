import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import { normalizeEmail } from '../auth/email-code.js';
import { revokeAccountAccess } from './account-safety.js';
import { safetyError } from './safety-errors.js';
export interface RecoveryAccount {
  id: string;
  principal_id: string;
  email: string;
}
export function recoveryEmail(value: unknown): string {
  const email: string | null =
    typeof value === 'string' && value.length <= 254 ? normalizeEmail(value) : null;
  if (!email) safetyError(400, 'INVALID_EMAIL');
  return email;
}
export async function prepareEmailRecovery(
  client: PoolClient,
  account: RecoveryAccount,
  actor: string,
  email: string,
  reason: string,
  relatedReportPublicId: unknown,
): Promise<string> {
  if (email === account.email) safetyError(400, 'INVALID_EMAIL');
  if (
    (
      await client.query('SELECT 1 FROM user_account WHERE email=$1 AND deleted_at IS NULL', [
        email,
      ])
    ).rowCount !== 0
  )
    safetyError(409, 'EMAIL_UNAVAILABLE');
  const pending: QueryResult = await client.query(
    "SELECT 1 FROM administrative_email_recovery WHERE user_account_id=$1 AND created_at>now()-interval '1 minute'",
    [account.id],
  );
  if (pending.rowCount !== 0) safetyError(429, 'RECOVERY_COOLDOWN');
  const token: string = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO administrative_email_recovery (user_account_id,actor_principal_id,new_email,token_hash,reason,related_report_public_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '1 hour')
 ON CONFLICT (user_account_id) DO UPDATE SET reason=EXCLUDED.reason,related_report_public_id=EXCLUDED.related_report_public_id,actor_principal_id=EXCLUDED.actor_principal_id,new_email=EXCLUDED.new_email,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,created_at=now()`,
    [
      account.id,
      actor,
      email,
      createHash('sha256').update(token).digest(),
      reason,
      relatedReportPublicId ?? null,
    ],
  );
  return token;
}
export async function completeEmailRecovery(
  client: PoolClient,
  account: RecoveryAccount,
  actor: string,
  email: string,
  token: unknown,
): Promise<void> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    safetyError(400, 'INVALID_RECOVERY_PROOF');
  const proof: QueryResult = await client.query(
    'SELECT 1 FROM administrative_email_recovery WHERE user_account_id=$1 AND actor_principal_id=$2 AND new_email=$3 AND token_hash=$4 AND expires_at>now() FOR UPDATE',
    [account.id, actor, email, createHash('sha256').update(token).digest()],
  );
  if (proof.rowCount !== 1) safetyError(400, 'INVALID_RECOVERY_PROOF');
  if (
    (
      await client.query(
        'SELECT 1 FROM user_account WHERE email=$1 AND deleted_at IS NULL AND id<>$2',
        [email, account.id],
      )
    ).rowCount !== 0
  )
    safetyError(409, 'EMAIL_UNAVAILABLE');
  await client.query('UPDATE user_account SET email=$1,updated_at=now() WHERE id=$2', [
    email,
    account.id,
  ]);
  await revokeAccountAccess(client, account.id, account.principal_id, account.email);
  await client.query(
    'UPDATE email_one_time_code SET consumed_at=now() WHERE normalized_email=$1 AND consumed_at IS NULL',
    [email],
  );
}
