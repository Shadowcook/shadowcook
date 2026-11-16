import type { PoolClient, QueryResult } from 'pg';
import { safetyError } from './safety-errors.js';
export async function requireUsableAdministrator(
  client: PoolClient,
  emailAvailable: boolean,
): Promise<void> {
  const result: QueryResult<{ permitted: boolean }> = await client.query(
    `SELECT EXISTS (
  SELECT 1 FROM user_account u JOIN principal p ON p.id=u.principal_id CROSS JOIN (SELECT COALESCE((SELECT login_mode FROM instance_authentication_settings WHERE singleton=true),'PASSWORD_OR_EMAIL_CODE') AS login_mode) settings
  WHERE u.disabled_at IS NULL AND u.deleted_at IS NULL AND p.disabled_at IS NULL AND p.principal_type='USER'
  AND ((settings.login_mode<>'EMAIL_CODE_ONLY' AND u.password_hash IS NOT NULL) OR (settings.login_mode<>'PASSWORD_ONLY' AND $1))
  AND EXISTS (SELECT 1 FROM principal_instance_role r JOIN instance_role_permission permission ON permission.instance_role_id=r.instance_role_id WHERE r.principal_id=p.id AND permission.permission_code='instance:administer')
 ) AS permitted`,
    [emailAvailable],
  );
  if (result.rows[0]?.permitted !== true) safetyError(409, 'LAST_USABLE_ADMINISTRATOR');
}
export async function revokeAccountAccess(
  client: PoolClient,
  userId: string,
  principalId: string,
  email: string,
): Promise<void> {
  await client.query(
    'UPDATE user_session SET revoked_at=now() WHERE user_account_id=$1 AND revoked_at IS NULL',
    [userId],
  );
  for (const table of ['oauth_access_token', 'oauth_refresh_token'])
    await client.query(
      `UPDATE ${table} SET revoked_at=now() WHERE principal_id=$1 AND revoked_at IS NULL`,
      [principalId],
    );
  await client.query(
    'UPDATE oauth_authorization_code SET consumed_at=now() WHERE principal_id=$1 AND consumed_at IS NULL',
    [principalId],
  );
  await client.query(
    'UPDATE ai_context_grant SET revoked_at=now() WHERE created_by_principal_id=$1 AND revoked_at IS NULL',
    [principalId],
  );
  await client.query(
    'UPDATE password_reset_token SET consumed_at=now() WHERE user_account_id=$1 AND consumed_at IS NULL',
    [userId],
  );
  await client.query(
    'UPDATE email_one_time_code SET consumed_at=now() WHERE normalized_email=$1 AND consumed_at IS NULL',
    [email],
  );
  for (const table of ['user_invitation', 'tenant_invitation'])
    await client.query(
      `DELETE FROM ${table} WHERE accepted_at IS NULL AND (invited_email=$1 OR created_by_principal_id=$2)`,
      [email, principalId],
    );
  await client.query('DELETE FROM account_email_change WHERE user_account_id=$1', [userId]);
  await client.query(
    'DELETE FROM administrative_email_recovery WHERE user_account_id=$1 OR actor_principal_id=$2',
    [userId, principalId],
  );
}
