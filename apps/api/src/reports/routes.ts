import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { currentSessionUser, type AuthenticatedSessionUser } from '../auth/session.js';
import { parseReport, type ReportInput } from './model.js';
import { canReportTarget, reportableUsers } from './targets.js';
import { deliverReportNotifications } from './notifications.js';

export function registerReportRoutes(
  api: FastifyInstance,
  pool: Pool,
  secret: Buffer | null,
  origin: string,
): void {
  api.get(
    '/reports/users',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const user: AuthenticatedSessionUser | null = await requireReporter(pool, request, reply);
      if (user === null) return;
      const query: { tenantSlug?: unknown } = request.query as { tenantSlug?: unknown };
      if (typeof query.tenantSlug !== 'string' || query.tenantSlug.length > 120)
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT', error: 'A cookbook slug is required.' });
      return { users: await reportableUsers(pool, user.principal_id, query.tenantSlug) };
    },
  );
  api.post('/reports', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const user: AuthenticatedSessionUser | null = await requireReporter(pool, request, reply);
    if (user === null) return;
    const input: ReportInput | null = parseReport(request.body);
    if (input === null)
      return reply.code(400).send({ code: 'INVALID_REPORT', error: 'The report is invalid.' });
    const client: PoolClient = await pool.connect();
    let publicId: string;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `report:${user.id}`,
      ]);
      if (!(await canReportTarget(client, user.principal_id, input))) {
        await client.query('ROLLBACK');
        return reply
          .code(404)
          .send({ code: 'REPORT_TARGET_NOT_FOUND', error: 'The report target is unavailable.' });
      }
      const count: QueryResult<{ count: number }> = await client.query(
        "SELECT count(*)::integer AS count FROM content_report WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'",
        [user.id],
      );
      if ((count.rows[0]?.count ?? 0) >= 10) {
        await client.query('ROLLBACK');
        return reply
          .code(429)
          .header('Retry-After', '3600')
          .send({ code: 'REPORT_RATE_LIMITED', error: 'Too many reports.' });
      }
      const result: QueryResult<{ public_id: string }> = await client.query(
        'INSERT INTO content_report (reporter_user_id, target_type, target_public_id, reason, description) VALUES ($1, $2, $3, $4, $5) RETURNING public_id',
        [user.id, input.targetType, input.targetPublicId, input.reason, input.description],
      );
      publicId = result.rows[0]!.public_id;
      await client.query('INSERT INTO content_report_notification (report_public_id) VALUES ($1)', [
        publicId,
      ]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    try {
      await deliverReportNotifications(pool, secret, origin, publicId);
    } catch {
      request.log.warn({ reportId: publicId }, 'Report notification remains queued');
    }
    return reply.code(201).send({ publicId });
  });
}

async function requireReporter(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedSessionUser | null> {
  const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
  if (user === null) {
    reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    return null;
  }
  if (user.password_change_required) {
    reply
      .code(403)
      .send({ code: 'PASSWORD_CHANGE_REQUIRED', error: 'A password change is required.' });
    return null;
  }
  return user;
}
