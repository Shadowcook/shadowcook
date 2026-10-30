import type { Pool, PoolClient, QueryResult } from 'pg';
import { verifyPassword } from './password.js';
import { issueSession, type BrowserSession } from './browser-session.js';

interface PasswordLoginUser {
  id: string;
  password_hash: string | null;
  password_change_required: boolean;
  disabled_at: Date | null;
}

interface LoginFailureWindow {
  failed_attempts: number;
  retry_after_seconds: number | null;
}

export type PasswordLoginResult =
  | { status: 'invalid-credentials' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'authenticated'; user: PasswordLoginUser; session: BrowserSession };

export async function attemptPasswordLogin(
  pool: Pool,
  clientIp: string,
  email: string,
  password: string,
): Promise<PasswordLoginResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('shadowcook-password-login:' || host($1::inet), 0))",
      [clientIp],
    );
    const failures: LoginFailureWindow = (
      await client.query<LoginFailureWindow>(
        `SELECT count(*)::integer AS failed_attempts,
          GREATEST(1, ceil(EXTRACT(EPOCH FROM
            (min(created_at) + interval '15 minutes' - clock_timestamp()))))::integer AS retry_after_seconds
         FROM password_login_failure
         WHERE client_ip = $1::inet AND created_at > clock_timestamp() - interval '15 minutes'`,
        [clientIp],
      )
    ).rows[0];
    if (failures.failed_attempts >= 10) {
      await client.query('COMMIT');
      return { status: 'rate-limited', retryAfterSeconds: failures.retry_after_seconds ?? 900 };
    }

    const result: QueryResult<PasswordLoginUser> = await client.query<PasswordLoginUser>(
      `SELECT id, password_hash, password_change_required, disabled_at
       FROM user_account WHERE email = $1 AND deleted_at IS NULL FOR UPDATE`,
      [email.trim().toLowerCase()],
    );
    const user: PasswordLoginUser | undefined = result.rows[0];
    if (
      user === undefined ||
      user.disabled_at !== null ||
      user.password_hash === null ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      await client.query('INSERT INTO password_login_failure (client_ip) VALUES ($1::inet)', [
        clientIp,
      ]);
      await client.query('COMMIT');
      return { status: 'invalid-credentials' };
    }

    const session: BrowserSession = await issueSession(client, user.id);
    await client.query('COMMIT');
    return { status: 'authenticated', user, session };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupExpiredPasswordLoginFailures(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM password_login_failure WHERE created_at <= clock_timestamp() - interval '15 minutes'",
  );
}
