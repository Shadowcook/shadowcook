import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { requireAdministrativeActor } from './authorization.js';
import { setAuditRetentionDays } from './audit-retention.js';

export function registerAuditSettingsRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/audit-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      (await requireAdministrativeActor(pool, request, reply, 'ADMIN_AUDIT_POLICY_READ', false)) ===
      null
    )
      return;
    const result: QueryResult<{ retention_days: number }> = await pool.query(
      'SELECT retention_days FROM administrative_audit_policy WHERE singleton = true',
    );
    if (result.rows[0] === undefined) throw new Error('Administrative audit policy is missing.');
    return reply
      .header('Cache-Control', 'no-store')
      .send({ retentionDays: result.rows[0].retention_days });
  });

  api.put('/admin/audit-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      (await requireAdministrativeActor(
        pool,
        request,
        reply,
        'ADMIN_AUDIT_POLICY_UPDATED',
        false,
      )) === null
    )
      return;
    const body: unknown = request.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('retentionDays' in body) ||
      typeof body.retentionDays !== 'number' ||
      !Number.isSafeInteger(body.retentionDays) ||
      body.retentionDays < 1 ||
      body.retentionDays > 3650
    ) {
      return reply
        .code(400)
        .send({
          code: 'INVALID_AUDIT_SETTINGS',
          error: 'The audit retention settings are invalid.',
        });
    }
    await setAuditRetentionDays(pool, body.retentionDays);
    return reply.code(204).send();
  });
}
