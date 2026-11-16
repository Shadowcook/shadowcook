import { createHash } from 'node:crypto';
import { serializeAdministrativeState } from './audit-input.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { completeEmailRecovery, type RecoveryAccount } from './account-recovery.js';
import { requireUsableAdministrator } from './account-safety.js';
import { isSmtpConfigured } from './mail-routes.js';
import { safetyError, sendSafetyError } from './safety-errors.js';
import { isRecord } from '../reports/model.js';
import { sendTemplatedInstanceMail } from '../mail/service.js';

interface PendingRecovery {
  user_account_id: string;
  actor_principal_id: string;
  new_email: string;
  reason: string;
  related_report_public_id: string | null;
}
interface Account extends RecoveryAccount {
  public_id: string;
}

export function registerEmailRecoveryConfirmation(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
): void {
  api.post(
    '/auth/email-recovery/complete',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      reply.header('Cache-Control', 'private, no-store');
      const body: unknown = request.body;
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        typeof body.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.token)
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_RECOVERY_PROOF', error: 'Invalid recovery link.' });
      const client: PoolClient = await pool.connect();
      let oldEmail: string;
      let newEmail: string;
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('administrative-account-safety'))",
        );
        const pending: QueryResult<PendingRecovery> = await client.query(
          'SELECT user_account_id,actor_principal_id,new_email,reason,related_report_public_id FROM administrative_email_recovery WHERE token_hash=$1 AND expires_at>now()',
          [createHash('sha256').update(body.token).digest()],
        );
        const recovery: PendingRecovery | undefined = pending.rows[0];
        if (!recovery) safetyError(400, 'INVALID_RECOVERY_PROOF');
        const accounts: QueryResult<Account> = await client.query(
          `SELECT u.id,u.public_id,u.principal_id,u.email FROM user_account u JOIN principal p ON p.id=u.principal_id
        WHERE u.id=$1 AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND p.disabled_at IS NULL AND p.principal_type='USER' FOR UPDATE OF u,p`,
          [recovery.user_account_id],
        );
        const account: Account | undefined = accounts.rows[0];
        if (!account) safetyError(400, 'INVALID_RECOVERY_PROOF');
        await completeEmailRecovery(
          client,
          account,
          recovery.actor_principal_id,
          recovery.new_email,
          body.token,
        );
        await requireUsableAdministrator(client, await isSmtpConfigured(pool, key));
        await client.query(
          `INSERT INTO administrative_audit_event
        (actor_principal_id,action,target_type,target_public_id,reason,new_state,request_id,related_report_public_id,outcome)
        VALUES ($1,'ADMIN_USER_EMAIL_RECOVERED','USER',$2,$3,$4,$5,$6,'SUCCEEDED')`,
          [
            recovery.actor_principal_id,
            account.public_id,
            recovery.reason,
            serializeAdministrativeState({
              status: 'EMAIL_RECOVERED',
              confirmation: 'RECIPIENT_LINK',
            }),
            request.id,
            recovery.related_report_public_id,
          ],
        );
        await client.query('COMMIT');
        oldEmail = account.email;
        newEmail = recovery.new_email;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ code: 'EMAIL_UNAVAILABLE', error: 'Email unavailable.' });
        return sendSafetyError(reply, error);
      } finally {
        client.release();
      }
      for (const address of [oldEmail, newEmail]) {
        let delivered: boolean = false;
        try {
          delivered = await sendTemplatedInstanceMail(
            pool,
            key,
            address,
            'ADMIN_EMAIL_RECOVERED',
            {},
          );
        } catch {}
        if (!delivered)
          request.log.warn(
            { requestId: request.id, outcome: 'FAILED' },
            'Account recovery notification failed',
          );
      }
      return reply.code(204).send();
    },
  );
}
