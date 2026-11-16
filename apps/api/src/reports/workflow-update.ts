import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  executeAdministrativeMutation,
  type AdministrativeResult,
} from '../admin/audit-operation.js';
import { safetyError, sendSafetyError } from '../admin/safety-errors.js';
import { isUuid, parseReportUpdate, type ReportUpdate } from './model.js';

export function registerReportWorkflowUpdate(
  api: FastifyInstance,
  pool: Pool,
  administratorSql: string,
): void {
  api.put(
    '/admin/reports/:publicId',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Referrer-Policy', 'no-referrer');
      const publicId: unknown = (request.params as { publicId?: unknown }).publicId;
      const input: ReportUpdate | null = parseReportUpdate(request.body);
      if (!isUuid(publicId) || !input)
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT_UPDATE', error: 'The report update is invalid.' });
      try {
        const result: AdministrativeResult<object> | null = await executeAdministrativeMutation(
          pool,
          request,
          reply,
          {
            action: 'ADMIN_REPORT_UPDATED',
            targetType: 'REPORT',
            targetPublicId: publicId,
          },
          { reason: 'REPORT_WORKFLOW_UPDATE', relatedReportPublicId: publicId },
          async (client: PoolClient): Promise<AdministrativeResult<object>> => {
            const prior: QueryResult<{
              status: string;
              result: string | null;
              assignee: string | null;
            }> = await client.query(
              `SELECT report.status, report.result, account.public_id AS assignee FROM content_report report
            LEFT JOIN user_account account ON account.id = report.assigned_admin_user_id
            WHERE report.public_id = $1 FOR UPDATE OF report`,
              [publicId],
            );
            if (!prior.rows[0]) safetyError(404, 'REPORT_NOT_FOUND');
            // Ticket decisions never invoke moderation, ownership, deletion or mail services.
            const updated: QueryResult = await client.query(
              `UPDATE content_report SET status = $2, result = $3, result_note = $4,
            assigned_admin_user_id = (SELECT id FROM (${administratorSql}) administrators WHERE "publicId" = $5), updated_at = now()
            WHERE public_id = $1 AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM (${administratorSql}) administrators WHERE "publicId" = $5))`,
              [publicId, input.status, input.result, input.resultNote, input.assignedAdminPublicId],
            );
            if (updated.rowCount !== 1) safetyError(400, 'INVALID_REPORT_ASSIGNEE');
            return {
              value: {},
              previousState: {
                status: prior.rows[0].status,
                reportResult: prior.rows[0].result,
                assigneePublicId: prior.rows[0].assignee,
              },
              newState: {
                status: input.status,
                reportResult: input.result,
                assigneePublicId: input.assignedAdminPublicId,
              },
            };
          },
        );
        if (result) return reply.code(204).send();
      } catch (error: unknown) {
        return sendSafetyError(reply, error);
      }
    },
  );
}
