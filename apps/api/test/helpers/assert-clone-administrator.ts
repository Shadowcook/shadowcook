import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import { verifyPassword } from '../../src/auth/password.js';
import { configureCloneAdministrator } from '../../src/development/clone-administrator.js';

interface AdministratorRow {
  id: string;
  principal_id: string;
  password_hash: string;
  password_change_required: boolean;
  disabled_at: Date | null;
  role_code: string;
}

async function main(): Promise<void> {
  const databaseUrl: string | undefined = process.env.CLONE_TEST_DATABASE_URL;
  assert.ok(databaseUrl);
  const pool: Pool = new Pool({ connectionString: databaseUrl });
  try {
    const initial: QueryResult<AdministratorRow> = await pool.query<AdministratorRow>(
      `SELECT account.id, account.principal_id, account.password_hash,
        account.password_change_required, account.disabled_at, role.code AS role_code
       FROM user_account account
       JOIN principal_instance_role assignment ON assignment.principal_id = account.principal_id
       JOIN instance_role role ON role.id = assignment.instance_role_id
       WHERE account.email = 'admin@local' AND account.deleted_at IS NULL`,
    );
    assert.equal(initial.rows.length, 1);
    const administrator: AdministratorRow = initial.rows[0];
    assert.equal(administrator.role_code, 'administrator');
    assert.equal(administrator.password_change_required, false);
    assert.equal(administrator.disabled_at, null);
    assert.equal(
      await verifyPassword('eR7!vQ2#nL9@xC4$kM8%pT6&zA1*', administrator.password_hash),
      true,
    );
    await assert.rejects(configureCloneAdministrator(pool, ''), /must not be empty/);
    await assert.rejects(configureCloneAdministrator(pool, 'password'), /estimated entropy/);
    const afterFailure: QueryResult<{ password_hash: string }> = await pool.query<{
      password_hash: string;
    }>('SELECT password_hash FROM user_account WHERE id = $1', [administrator.id]);
    assert.equal(afterFailure.rows[0].password_hash, administrator.password_hash);

    await pool.query(
      `INSERT INTO user_session (user_account_id, token_hash, expires_at)
       VALUES ($1, decode(repeat('ab', 32), 'hex'), now() + interval '1 day')`,
      [administrator.id],
    );
    await pool.query(
      `INSERT INTO instance_authentication_settings (singleton, login_mode)
       VALUES (true, 'EMAIL_CODE_ONLY')
       ON CONFLICT (singleton) DO UPDATE SET login_mode = 'EMAIL_CODE_ONLY'`,
    );
    const newPassword: string = 'bQ8@pR6!xV9#cL3$mN7%kT4&zA2*';
    await configureCloneAdministrator(pool, newPassword);
    const updated: QueryResult<{ id: string; password_hash: string }> = await pool.query<{
      id: string;
      password_hash: string;
    }>("SELECT id, password_hash FROM user_account WHERE email = 'admin@local'");
    assert.equal(updated.rows.length, 1);
    assert.equal(updated.rows[0].id, administrator.id);
    assert.equal(await verifyPassword(newPassword, updated.rows[0].password_hash), true);
    assert.equal(
      await verifyPassword('eR7!vQ2#nL9@xC4$kM8%pT6&zA1*', updated.rows[0].password_hash),
      false,
    );
    const sessions: QueryResult<{ count: string }> = await pool.query<{ count: string }>(
      'SELECT count(*) FROM user_session WHERE user_account_id = $1 AND revoked_at IS NULL',
      [administrator.id],
    );
    assert.equal(sessions.rows[0].count, '0');
    const mode: QueryResult<{ login_mode: string }> = await pool.query<{ login_mode: string }>(
      'SELECT login_mode FROM instance_authentication_settings WHERE singleton = true',
    );
    assert.equal(mode.rows[0].login_mode, 'PASSWORD_OR_EMAIL_CODE');
    console.log(
      'PASS: admin password verifies; role, password policy, reset, session revocation, and password login',
    );
  } finally {
    await pool.end();
  }
}

await main();
