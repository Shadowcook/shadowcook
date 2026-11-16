import type { Pool, PoolClient } from 'pg';
import { createPasswordHash } from '../auth/password-hash.js';
import { prepareCloneLocalAdministrator } from './clone-local-administrator.js';
import { cloneAssignments, readCloneColumns } from './clone-schema.js';
import type { CloneColumns } from './clone-schema.js';

export function validateClonePassword(password: string): void {
  if (password.length === 0) throw new Error('The test password must not be empty.');
  if (password.length > 1024) throw new Error('Password must not exceed 1024 characters.');
}

export async function configureCloneAdministrator(pool: Pool, password: string): Promise<boolean> {
  validateClonePassword(password);
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shadowcook-clone-administrator'))");
    const accounts: CloneColumns = await readCloneColumns(client, 'user_account');
    const passwordHash: string = await createPasswordHash(password);
    const administratorReady: boolean = await prepareCloneLocalAdministrator(
      client,
      accounts,
      passwordHash,
    );
    const updates: string[] = cloneAssignments(accounts, {
      password_hash: '$1',
      password_change_required: 'false',
      password_changed_at: 'now()',
    });
    if (updates.length > 0) {
      await client.query(
        `UPDATE public.user_account SET ${updates.join(', ')}`,
        accounts.has('password_hash') ? [passwordHash] : [],
      );
    }
    const sessions: CloneColumns = await readCloneColumns(client, 'user_session');
    if (sessions.size > 0) await client.query('DELETE FROM public.user_session');
    const authentication: CloneColumns = await readCloneColumns(
      client,
      'instance_authentication_settings',
    );
    if (authentication.has('login_mode')) {
      await client.query(
        `DO $$ BEGIN
           UPDATE public.instance_authentication_settings SET login_mode = 'PASSWORD_OR_EMAIL_CODE'
           WHERE login_mode = 'EMAIL_CODE_ONLY';
         EXCEPTION WHEN check_violation OR invalid_text_representation THEN
           RAISE NOTICE 'Copied authentication schema does not support password-or-email-code login; keeping its login mode.';
         END; $$;`,
      );
    }
    await client.query('COMMIT');
    return administratorReady;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
