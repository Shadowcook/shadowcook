import type { PoolClient, QueryResult } from 'pg';
import {
  canInsertCloneRow,
  cloneAssignments,
  cloneIdentifier,
  hasCloneColumns,
  readCloneColumns,
} from './clone-schema.js';
import type { CloneColumns } from './clone-schema.js';

export async function prepareCloneLocalAdministrator(
  client: PoolClient,
  accounts: CloneColumns,
  passwordHash: string,
): Promise<boolean> {
  const principals: CloneColumns = await readCloneColumns(client, 'principal');
  const roles: CloneColumns = await readCloneColumns(client, 'instance_role');
  const assignments: CloneColumns = await readCloneColumns(client, 'principal_instance_role');
  const accountValues: Record<string, unknown> = {
    principal_id: null,
    email: 'admin@local',
    display_name: 'Local administrator',
    password_hash: passwordHash,
    password_changed_at: new Date(),
  };
  if (
    !hasCloneColumns(accounts, ['principal_id', 'email', 'password_hash']) ||
    !hasCloneColumns(principals, ['id', 'principal_type']) ||
    !hasCloneColumns(roles, ['id', 'code']) ||
    !hasCloneColumns(assignments, ['principal_id', 'instance_role_id']) ||
    !canInsertCloneRow(accounts, Object.keys(accountValues)) ||
    !canInsertCloneRow(principals, ['principal_type']) ||
    !canInsertCloneRow(assignments, ['principal_id', 'instance_role_id'])
  )
    return false;

  const role: QueryResult<{ id: string }> = await client.query<{ id: string }>(
    "SELECT id FROM public.instance_role WHERE code = 'administrator'",
  );
  if (role.rows.length !== 1) return false;
  const existing: QueryResult<{ principal_id: string }> = await client.query<{
    principal_id: string;
  }>(
    `SELECT principal_id FROM public.user_account WHERE email = 'admin@local'
     ${accounts.has('deleted_at') ? 'AND deleted_at IS NULL' : ''} FOR UPDATE`,
  );
  let principalId: string;
  if (existing.rows.length === 0) {
    const principal: QueryResult<{ id: string }> = await client.query<{ id: string }>(
      "INSERT INTO public.principal (principal_type) VALUES ('USER') RETURNING id",
    );
    principalId = principal.rows[0].id;
    accountValues.principal_id = principalId;
    const names: string[] = Object.keys(accountValues).filter((name: string): boolean =>
      accounts.has(name),
    );
    const parameters: string[] = names.map(
      (_name: string, index: number): string => `$${index + 1}`,
    );
    await client.query(
      `INSERT INTO public.user_account (${names.map(cloneIdentifier).join(', ')}) VALUES (${parameters.join(', ')})`,
      names.map((name: string): unknown => accountValues[name]),
    );
  } else {
    principalId = existing.rows[0].principal_id;
    const updates: string[] = cloneAssignments(accounts, {
      disabled_at: 'NULL',
      updated_at: 'now()',
    });
    if (updates.length > 0) {
      await client.query(
        `UPDATE public.user_account SET ${updates.join(', ')} WHERE principal_id = $1`,
        [principalId],
      );
    }
    if (principals.has('disabled_at')) {
      await client.query('UPDATE public.principal SET disabled_at = NULL WHERE id = $1', [
        principalId,
      ]);
    }
  }
  // This is the clone's local account only. No imported role assignments change.
  await client.query('DELETE FROM public.principal_instance_role WHERE principal_id = $1', [
    principalId,
  ]);
  await client.query(
    'INSERT INTO public.principal_instance_role (principal_id, instance_role_id) VALUES ($1, $2)',
    [principalId, role.rows[0].id],
  );
  return true;
}
