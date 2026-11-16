import { requireInstancePermission } from './authorization.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { executeAdministrativeMutation, type AdministrativeResult } from './audit-operation.js';
import { requireUsableAdministrator, revokeAccountAccess } from './account-safety.js';
import { prepareEmailRecovery, recoveryEmail, type RecoveryAccount } from './account-recovery.js';
import { isRecord, isUuid } from '../reports/model.js';
import { safetyError, sendSafetyError } from './safety-errors.js';
import { isSmtpConfigured } from './mail-routes.js';
import { sendTemplatedInstanceMail } from '../mail/service.js';
interface AccountRow extends RecoveryAccount {
  disabled_at: Date | null;
}
interface AccountActionResult {
  newEmail?: string;
  token?: string;
}
export function registerAccountSafetyRoutes(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
  publicWebOrigin: string,
): void {
  for (const operation of ['status', 'delete', 'roles', 'email-recovery'] as const) {
    const suffix: string =
      operation === 'roles'
        ? '/instance-roles'
        : operation === 'email-recovery'
          ? '/email-recovery'
          : '';
    const handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<unknown> => {
      const publicId: unknown = (request.params as { publicId: unknown }).publicId;
      const body: unknown = request.body;
      if (!isUuid(publicId) || !isRecord(body))
        return reply
          .code(400)
          .send({ code: 'INVALID_ACCOUNT_ACTION', error: 'Invalid account action.' });
      // Display-name editing keeps its existing non-recovery behavior.
      if (
        operation === 'status' &&
        isRecord(body) &&
        Object.keys(body).length === 1 &&
        typeof body.displayName === 'string'
      ) {
        if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
          return;
        if (body.displayName.trim().length < 1 || body.displayName.trim().length > 120)
          return reply
            .code(400)
            .send({ code: 'INVALID_USER_UPDATE', error: 'Invalid account update.' });
        const changed: QueryResult = await pool.query(
          'UPDATE user_account SET display_name=$1,updated_at=now() WHERE public_id=$2 AND deleted_at IS NULL',
          [body.displayName.trim(), publicId],
        );
        return changed.rowCount === 1
          ? reply.code(204).send()
          : reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'User unavailable.' });
      }
      reply.header('Cache-Control', 'private, no-store');
      try {
        const emailAvailable: boolean = await isSmtpConfigured(pool, key);
        const result: AdministrativeResult<AccountActionResult> | null =
          await executeAdministrativeMutation(
            pool,
            request,
            reply,
            {
              action:
                operation === 'email-recovery'
                  ? 'ADMIN_USER_EMAIL_CONFIRMATION_REQUESTED'
                  : `ADMIN_USER_${operation.toUpperCase().replace('-', '_')}`,
              targetType: 'USER',
              targetPublicId: publicId,
            },
            {
              reason: body.reason,
              ...(body.relatedReportPublicId === undefined
                ? {}
                : { relatedReportPublicId: body.relatedReportPublicId }),
            },
            async (
              client: PoolClient,
              actor: string,
            ): Promise<AdministrativeResult<AccountActionResult>> => {
              const allowed: string[] = [
                'reason',
                'relatedReportPublicId',
                'confirmed',
                ...(operation === 'status'
                  ? ['disabled']
                  : operation === 'roles'
                    ? ['roleCodes']
                    : operation === 'delete'
                      ? ['confirmation']
                      : ['email']),
              ];
              if (
                body.confirmed !== true ||
                Object.keys(body).some((field: string): boolean => !allowed.includes(field))
              )
                safetyError(400, 'INVALID_ACCOUNT_ACTION');
              const found: QueryResult<AccountRow> = await client.query(
                `SELECT id,principal_id,email,disabled_at FROM user_account WHERE public_id=$1 AND deleted_at IS NULL FOR UPDATE`,
                [publicId],
              );
              const account: AccountRow | undefined = found.rows[0];
              if (!account) safetyError(404, 'RESOURCE_NOT_FOUND');
              if (operation === 'delete') {
                if (body.confirmation !== publicId) safetyError(400, 'INVALID_ACCOUNT_ACTION');
                if (
                  (
                    await client.query('SELECT 1 FROM tenant WHERE owner_principal_id=$1', [
                      account.principal_id,
                    ])
                  ).rowCount !== 0
                )
                  safetyError(409, 'OWNED_COOKBOOKS_REMAIN');
                await client.query(
                  'UPDATE user_account SET deleted_at=now(),disabled_at=now(),updated_at=now() WHERE id=$1',
                  [account.id],
                );
                await client.query('UPDATE principal SET disabled_at=now() WHERE id=$1', [
                  account.principal_id,
                ]);
                await revokeAccountAccess(client, account.id, account.principal_id, account.email);
              } else if (operation === 'status') {
                if (typeof body.disabled !== 'boolean') safetyError(400, 'INVALID_ACCOUNT_ACTION');
                await client.query(
                  'UPDATE user_account SET disabled_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1',
                  [account.id, body.disabled],
                );
                await client.query(
                  'UPDATE principal SET disabled_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1',
                  [account.principal_id, body.disabled],
                );
                if (body.disabled)
                  await revokeAccountAccess(
                    client,
                    account.id,
                    account.principal_id,
                    account.email,
                  );
              } else if (operation === 'roles') {
                if (
                  !Array.isArray(body.roleCodes) ||
                  body.roleCodes.length > 32 ||
                  !body.roleCodes.every((value: unknown): boolean => typeof value === 'string') ||
                  new Set(body.roleCodes).size !== body.roleCodes.length
                )
                  safetyError(400, 'INVALID_ACCOUNT_ACTION');
                const roles: QueryResult = await client.query(
                  'SELECT code FROM instance_role WHERE code=ANY($1::text[])',
                  [body.roleCodes],
                );
                if (roles.rowCount !== body.roleCodes.length)
                  safetyError(400, 'INVALID_ACCOUNT_ACTION');
                const priorRoles: QueryResult<{ code: string }> = await client.query(
                  'SELECT role.code FROM principal_instance_role assignment JOIN instance_role role ON role.id=assignment.instance_role_id WHERE assignment.principal_id=$1 ORDER BY role.code',
                  [account.principal_id],
                );
                await client.query('DELETE FROM principal_instance_role WHERE principal_id=$1', [
                  account.principal_id,
                ]);
                await client.query(
                  'INSERT INTO principal_instance_role SELECT $1,id FROM instance_role WHERE code=ANY($2::text[])',
                  [account.principal_id, body.roleCodes],
                );
                await requireUsableAdministrator(client, emailAvailable);
                return {
                  value: {},
                  previousState: {
                    roleCodes: priorRoles.rows.map((row: { code: string }): string => row.code),
                  },
                  newState: { roleCodes: body.roleCodes as string[], status: 'ROLES_CHANGED' },
                };
              } else {
                if (account.disabled_at !== null) safetyError(409, 'RECOVERY_ACCOUNT_DISABLED');
                const email: string = recoveryEmail(body.email);
                return {
                  value: {
                    newEmail: email,
                    token: await prepareEmailRecovery(
                      client,
                      account,
                      actor,
                      email,
                      String(body.reason).trim(),
                      body.relatedReportPublicId,
                    ),
                  },
                  newState: { status: 'EMAIL_CONFIRMATION_REQUESTED' },
                };
              }
              await requireUsableAdministrator(client, emailAvailable);
              return {
                value: {},
                previousState: { disabled: account.disabled_at !== null },
                newState: {
                  status:
                    operation === 'delete'
                      ? 'ACCOUNT_DELETED'
                      : body.disabled
                        ? 'ACCOUNT_DISABLED'
                        : 'ACCOUNT_ENABLED',
                },
              };
            },
          );
        if (!result) return;
        if (operation === 'email-recovery') {
          let delivered: boolean = false;
          try {
            delivered = await sendTemplatedInstanceMail(
              pool,
              key,
              result.value.newEmail!,
              'ADMIN_EMAIL_RECOVERY_PROOF',
              {
                action_url: `${publicWebOrigin}/auth/email-recovery/${result.value.token!}`,
                expires_in: '1 hour',
              },
            );
          } catch {}
          if (!delivered)
            request.log.warn(
              { requestId: request.id, outcome: 'FAILED' },
              'Account recovery link delivery failed',
            );
          return {
            deliveries: [{ recipient: 'NEW_ADDRESS', status: delivered ? 'SENT' : 'FAILED' }],
          };
        }
        return reply.code(204).send();
      } catch (error: unknown) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ code: 'EMAIL_UNAVAILABLE', error: 'Email unavailable.' });
        return sendSafetyError(reply, error);
      }
    };
    if (operation === 'status') api.patch('/admin/users/:publicId', handler);
    else if (operation === 'delete') api.delete('/admin/users/:publicId', handler);
    else if (operation === 'roles') api.put(`/admin/users/:publicId${suffix}`, handler);
    else api.post(`/admin/users/:publicId${suffix}`, handler);
  }
}
