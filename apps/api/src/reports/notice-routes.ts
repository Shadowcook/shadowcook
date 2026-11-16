import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  executeAdministrativeMutation,
  type AdministrativeResult,
} from '../admin/audit-operation.js';
import { safetyError, sendSafetyError } from '../admin/safety-errors.js';
import { sendTemplatedInstanceMail } from '../mail/service.js';
import { isRecord, isUuid } from './model.js';
import { reportContext, type ReportContext, type ReportRecipient } from './admin-context.js';

interface PreparedNotice {
  publicId: string;
  email: string;
  message: string;
  reviewInstructions: string;
}

export function registerReportNoticeRoutes(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
): void {
  api.post(
    '/admin/reports/:publicId/notices',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Referrer-Policy', 'no-referrer');
      const reportId: unknown = (request.params as { publicId: unknown }).publicId;
      const body: unknown = request.body;
      if (!isUuid(reportId) || !isRecord(body))
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT_NOTICE', error: 'Invalid report notice.' });
      try {
        const result: AdministrativeResult<PreparedNotice> | null =
          await executeAdministrativeMutation(
            pool,
            request,
            reply,
            {
              action: 'ADMIN_REPORT_NOTICE_CREATED',
              targetType: 'REPORT',
              targetPublicId: reportId,
            },
            { reason: body.reason, relatedReportPublicId: reportId },
            async (client: PoolClient): Promise<AdministrativeResult<PreparedNotice>> => {
              if (
                body.confirmed !== true ||
                typeof body.recipientRole !== 'string' ||
                !['REPORTER', 'TARGET'].includes(body.recipientRole) ||
                !isUuid(body.expectedRecipientPublicId) ||
                typeof body.message !== 'string' ||
                body.message.trim().length < 1 ||
                Array.from(body.message).length > 5000 ||
                typeof body.reviewInstructions !== 'string' ||
                body.reviewInstructions.trim().length < 1 ||
                Array.from(body.reviewInstructions).length > 2000 ||
                Object.keys(body).some(
                  (field: string): boolean =>
                    ![
                      'reason',
                      'confirmed',
                      'recipientRole',
                      'expectedRecipientPublicId',
                      'message',
                      'reviewInstructions',
                    ].includes(field),
                )
              )
                safetyError(400, 'INVALID_REPORT_NOTICE');
              let context: ReportContext = await reportContext(client, reportId);
              if (context.cookbookPublicId) {
                await client.query('SELECT id FROM tenant WHERE public_id = $1 FOR SHARE', [
                  context.cookbookPublicId,
                ]);
                context = await reportContext(client, reportId);
              }
              const recipient: ReportRecipient | undefined = context.recipients.find(
                (candidate: ReportRecipient): boolean => candidate.role === body.recipientRole,
              );
              if (!recipient || recipient.publicId !== body.expectedRecipientPublicId)
                safetyError(409, 'STALE_NOTICE_RECIPIENT');
              const account: QueryResult<{ id: string; email: string }> = await client.query(
                'SELECT id, email FROM user_account WHERE public_id = $1 AND deleted_at IS NULL FOR SHARE',
                [recipient.publicId],
              );
              if (!account.rows[0]) safetyError(409, 'STALE_NOTICE_RECIPIENT');
              const notice: QueryResult<{ public_id: string }> = await client.query(
                `INSERT INTO administrative_report_notice (report_public_id, recipient_user_id, recipient_role, message, review_instructions)
            VALUES ($1, $2, $3, $4, $5) RETURNING public_id`,
                [
                  reportId,
                  account.rows[0].id,
                  recipient.role,
                  body.message.trim(),
                  body.reviewInstructions.trim(),
                ],
              );
              return {
                value: {
                  publicId: notice.rows[0]!.public_id,
                  email: account.rows[0].email,
                  message: body.message.trim(),
                  reviewInstructions: body.reviewInstructions.trim(),
                },
                newState: { noticePublicId: notice.rows[0]!.public_id, status: 'NOTICE_CREATED' },
              };
            },
          );
        if (!result) return;
        let sent: boolean = false;
        try {
          sent = await sendTemplatedInstanceMail(
            pool,
            key,
            result.value.email,
            'REPORT_DECISION_NOTICE',
            {
              report_id: reportId,
              notice_id: result.value.publicId,
              notice_message: result.value.message,
              review_instructions: result.value.reviewInstructions,
            },
          );
        } catch {
          /* Do not log addresses, notice text or transport exception details. */
        }
        const status: 'SENT' | 'FAILED' = sent ? 'SENT' : 'FAILED';
        await pool.query(
          "UPDATE administrative_report_notice SET delivery_status = $2, delivered_at = CASE WHEN $2 = 'SENT' THEN now() ELSE NULL END WHERE public_id = $1",
          [result.value.publicId, status],
        );
        if (!sent)
          request.log.warn(
            { noticeId: result.value.publicId, requestId: request.id, outcome: 'FAILED' },
            'Report notice delivery failed',
          );
        return { noticePublicId: result.value.publicId, deliveryStatus: status };
      } catch (error: unknown) {
        return sendSafetyError(reply, error);
      }
    },
  );
}
