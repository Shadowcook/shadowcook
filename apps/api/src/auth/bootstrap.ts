import type { Pool } from 'pg';
import { generateBootstrapPassword, hashPassword } from './password.js';

export interface BootstrapAdminResult {
  created: boolean;
  email: string | null;
  password: string | null;
}

export interface BootstrapAdministratorOptions {
  email: string;
  password: string | null;
  passwordChangeRequired: boolean;
}

export async function bootstrapAdministrator(
  pool: Pool,
  options: BootstrapAdministratorOptions,
): Promise<BootstrapAdminResult> {
  const normalizedEmail: string = options.email.trim().toLowerCase();
  if (normalizedEmail.length === 0) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must not be empty.');
  }

  const password: string = options.password ?? generateBootstrapPassword();
  const passwordHash: string = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('shadowcook-bootstrap-administrator'))",
    );
    const administratorResult = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM principal_instance_role
        INNER JOIN instance_role ON instance_role.id = principal_instance_role.instance_role_id
        WHERE instance_role.code = 'administrator'
      ) AS exists
    `);
    if (administratorResult.rows[0]?.exists === true) {
      await client.query('COMMIT');
      return { created: false, email: null, password: null };
    }
    const principalResult = await client.query<{ id: string }>(
      "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
    );
    const principalId: string = principalResult.rows[0].id;
    await client.query(
      `INSERT INTO user_account
        (principal_id, email, display_name, password_hash, password_change_required)
       VALUES ($1, $2, 'Bootstrap administrator', $3, $4)`,
      [principalId, normalizedEmail, passwordHash, options.passwordChangeRequired],
    );
    await client.query(
      `INSERT INTO principal_instance_role (principal_id, instance_role_id)
       SELECT $1, id FROM instance_role WHERE code = 'administrator'`,
      [principalId],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { created: true, email: normalizedEmail, password };
}
