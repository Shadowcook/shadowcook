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

interface UserPasswordRow {
  id: string;
  password_hash: string;
  password_change_required: boolean;
  password_changed_at: Date | null;
}

async function assertUserPasswords(pool: Pool, password: string): Promise<void> {
  const users: QueryResult<UserPasswordRow> = await pool.query<UserPasswordRow>(
    `SELECT id, password_hash, password_change_required, password_changed_at
     FROM user_account ORDER BY id`,
  );
  assert.equal(users.rows.length, 4);
  for (const user of users.rows) {
    assert.equal(await verifyPassword(password, user.password_hash), true, user.id);
    assert.equal(user.password_change_required, false, user.id);
    assert.ok(user.password_changed_at, user.id);
  }
  const statuses: QueryResult<{ disabled: boolean; deleted: boolean }> = await pool.query<{
    disabled: boolean;
    deleted: boolean;
  }>(`SELECT disabled_at IS NOT NULL AS disabled, deleted_at IS NOT NULL AS deleted
      FROM user_account WHERE email <> 'admin@local' ORDER BY created_at, id`);
  assert.deepEqual(statuses.rows, [
    { disabled: false, deleted: false },
    { disabled: true, deleted: false },
    { disabled: true, deleted: true },
  ]);
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
    await assertUserPasswords(pool, 'eR7!vQ2#nL9@xC4$kM8%pT6&zA1*');
    await assert.rejects(configureCloneAdministrator(pool, ''), /must not be empty/);
    await assert.rejects(configureCloneAdministrator(pool, 'password'), /estimated entropy/);
    const afterFailure: QueryResult<{ password_hash: string }> = await pool.query<{
      password_hash: string;
    }>('SELECT password_hash FROM user_account WHERE id = $1', [administrator.id]);
    assert.equal(afterFailure.rows[0].password_hash, administrator.password_hash);
    await assertUserPasswords(pool, 'eR7!vQ2#nL9@xC4$kM8%pT6&zA1*');

    await pool.query(
      `INSERT INTO user_session (user_account_id, token_hash, expires_at)
       SELECT id, decode(md5(id::text), 'hex'), now() + interval '1 day' FROM user_account`,
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
    await assertUserPasswords(pool, newPassword);
    assert.equal(
      await verifyPassword('eR7!vQ2#nL9@xC4$kM8%pT6&zA1*', updated.rows[0].password_hash),
      false,
    );
    const sessions: QueryResult<{ count: string }> = await pool.query<{ count: string }>(
      'SELECT count(*) FROM user_session WHERE revoked_at IS NULL',
    );
    assert.equal(sessions.rows[0].count, '0');
    const mode: QueryResult<{ login_mode: string }> = await pool.query<{ login_mode: string }>(
      'SELECT login_mode FROM instance_authentication_settings WHERE singleton = true',
    );
    assert.equal(mode.rows[0].login_mode, 'PASSWORD_OR_EMAIL_CODE');
    console.log(
      'PASS: all user passwords verify; statuses preserved; admin role, password policy, reset, session revocation, and password login',
    );
  } finally {
    await pool.end();
  }
}

await main();
