import type { Pool, PoolClient, QueryResult } from 'pg';
import { hashPassword, minimumPasswordEntropy } from '../auth/password.js';

export async function configureCloneAdministrator(pool: Pool, password: string): Promise<void> {
  if (password.length === 0) throw new Error('The test password must not be empty.');
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shadowcook-clone-administrator'))");
    const passwordHash: string = await hashPassword(password, await minimumPasswordEntropy(client));
    const role: QueryResult<{ id: string }> = await client.query<{ id: string }>(
      "SELECT id FROM instance_role WHERE code = 'administrator'",
    );
    if (role.rows.length !== 1) throw new Error('The administrator role is missing.');
    const existing: QueryResult<{ principal_id: string }> = await client.query<{
      principal_id: string;
    }>(
      "SELECT principal_id FROM user_account WHERE email = 'admin@local' AND deleted_at IS NULL FOR UPDATE",
    );
    let principalId: string;
    if (existing.rows.length === 0) {
      const principal: QueryResult<{ id: string }> = await client.query<{ id: string }>(
        "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
      );
      principalId = principal.rows[0].id;
      await client.query(
        `INSERT INTO user_account
          (principal_id, email, display_name, password_hash, password_changed_at)
         VALUES ($1, 'admin@local', 'Local administrator', $2, now())`,
        [principalId, passwordHash],
      );
    } else {
      principalId = existing.rows[0].principal_id;
      await client.query(
        `UPDATE user_account SET password_hash = $1, password_change_required = false,
          password_changed_at = now(), disabled_at = NULL, updated_at = now()
         WHERE principal_id = $2`,
        [passwordHash, principalId],
      );
      await client.query('UPDATE principal SET disabled_at = NULL WHERE id = $1', [principalId]);
    }
    await client.query(
      `INSERT INTO principal_instance_role (principal_id, instance_role_id) VALUES ($1, $2)
       ON CONFLICT (principal_id) DO UPDATE SET instance_role_id = EXCLUDED.instance_role_id`,
      [principalId, role.rows[0].id],
    );
    await client.query(
      `UPDATE user_account SET password_hash = $1, password_change_required = false,
        password_changed_at = now()`,
      [passwordHash],
    );
    await client.query(
      `UPDATE user_session SET revoked_at = now()
       WHERE revoked_at IS NULL`,
    );
    await client.query(
      `UPDATE instance_authentication_settings SET login_mode = 'PASSWORD_OR_EMAIL_CODE'
       WHERE singleton = true AND login_mode = 'EMAIL_CODE_ONLY'`,
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
