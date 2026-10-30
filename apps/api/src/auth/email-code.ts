import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type EmailCodePurpose = 'LOGIN' | 'TENANT_INVITATION';
const lifetimeMilliseconds: number = 10 * 60 * 1000;
const emailLimit: number = 5;
const ipLimit: number = 20;

export function normalizeEmail(value: string): string | null {
  const email: string = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function hashEmailCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}
export function newEmailCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
export async function requestEmailCode(
  pool: Pool,
  email: string,
  purpose: EmailCodePurpose,
  ip: string | null,
  context: object = {},
): Promise<string | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const rates = await client.query<{ email_count: string; ip_count: string }>(
      `SELECT
      (SELECT count(*) FROM email_one_time_code WHERE normalized_email = $1 AND purpose = $2 AND created_at > now() - interval '10 minutes') AS email_count,
      (SELECT count(*) FROM email_one_time_code WHERE requested_ip = $3::inet AND purpose = $2 AND created_at > now() - interval '10 minutes') AS ip_count`,
      [email, purpose, ip],
    );
    if (
      Number(rates.rows[0]?.email_count ?? 0) >= emailLimit ||
      (ip !== null && Number(rates.rows[0]?.ip_count ?? 0) >= ipLimit)
    ) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      'UPDATE email_one_time_code SET consumed_at = now() WHERE normalized_email = $1 AND purpose = $2 AND consumed_at IS NULL',
      [email, purpose],
    );
    const code: string = newEmailCode();
    await client.query(
      'INSERT INTO email_one_time_code (normalized_email, purpose, code_hash, expires_at, requested_ip, context_data) VALUES ($1, $2, $3, $4, $5::inet, $6::jsonb)',
      [
        email,
        purpose,
        hashEmailCode(code),
        new Date(Date.now() + lifetimeMilliseconds),
        ip,
        JSON.stringify(context),
      ],
    );
    await client.query('COMMIT');
    return code;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function consumeEmailCode(
  pool: Pool,
  email: string,
  purpose: EmailCodePurpose,
  code: string,
): Promise<Record<string, unknown> | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      id: string;
      code_hash: Buffer;
      failed_attempts: number;
      max_failed_attempts: number;
      context_data: Record<string, unknown>;
    }>(
      'SELECT id, code_hash, failed_attempts, max_failed_attempts, context_data FROM email_one_time_code WHERE normalized_email = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE',
      [email, purpose],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.failed_attempts >= row.max_failed_attempts ||
      !timingSafeEqual(row.code_hash, hashEmailCode(code))
    ) {
      if (row !== undefined)
        await client.query(
          'UPDATE email_one_time_code SET failed_attempts = failed_attempts + 1, consumed_at = CASE WHEN failed_attempts + 1 >= max_failed_attempts THEN now() ELSE NULL END WHERE id = $1',
          [row.id],
        );
      await client.query('COMMIT');
      return null;
    }
    await client.query('UPDATE email_one_time_code SET consumed_at = now() WHERE id = $1', [
      row.id,
    ]);
    await client.query('COMMIT');
    return row.context_data;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
