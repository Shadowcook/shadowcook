import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  executeAdministrativeMutation,
  executeAdministrativeRead,
  type AdministrativeResult,
} from '../admin/audit-operation.js';
import { safetyError, sendSafetyError } from '../admin/safety-errors.js';
import { isRecord, isUuid } from './model.js';
import { reportContext, type ReportContext } from './admin-context.js';

export function registerReportHistoryRoutes(api: FastifyInstance, pool: Pool): void {
  for (const history of [true, false]) {
    api.post(
      `/admin/reports/:publicId/${history ? 'history' : 'events'}`,
      async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Referrer-Policy', 'no-referrer');
        const id: unknown = (request.params as { publicId: unknown }).publicId;
        const body: unknown = request.body;
        if (!isUuid(id) || !isRecord(body))
          return reply
            .code(400)
            .send({ code: 'INVALID_REPORT_HISTORY', error: 'Invalid report history request.' });
        try {
          const execute: typeof executeAdministrativeRead = history
            ? executeAdministrativeRead
            : executeAdministrativeMutation;
          const result: AdministrativeResult<object> | null = await execute<object>(
            pool,
            request,
            reply,
            {
              action: history ? 'ADMIN_REPORT_HISTORY_VIEWED' : 'ADMIN_REPORT_EVENT_LINKED',
              targetType: 'REPORT',
              targetPublicId: id,
            },
            { reason: body.reason, relatedReportPublicId: id },
            async (client: PoolClient): Promise<AdministrativeResult<object>> => {
              const context: ReportContext = await reportContext(client, id);
              if (
                Object.keys(body).some(
                  (field: string): boolean =>
                    !(
                      history ? ['reason', 'page'] : ['reason', 'confirmed', 'auditEventPublicId']
                    ).includes(field),
                )
              )
                safetyError(400, 'INVALID_REPORT_HISTORY');
              if (!history) {
                if (body.confirmed !== true || !isUuid(body.auditEventPublicId))
                  safetyError(400, 'INVALID_REPORT_HISTORY');
                const event: QueryResult = await client.query(
                  `SELECT id FROM administrative_audit_event WHERE id = $1 AND target_type <> 'REPORT'
                AND ((target_public_id, target_type) = (SELECT target_public_id, target_type FROM content_report WHERE public_id = $2)
                  OR ($3::uuid IS NOT NULL AND target_type = 'COOKBOOK' AND target_public_id = $3)) FOR SHARE`,
                  [body.auditEventPublicId, id, context.cookbookPublicId],
                );
                // A cookbook report may associate actions on its own nested recipes after deletion.
                if (event.rowCount !== 1) {
                  const nested: QueryResult = await client.query(
                    `SELECT event.id FROM administrative_audit_event event JOIN content_report report
                  ON report.public_id = $2 AND report.target_type = 'COOKBOOK' AND report.target_public_id = event.cookbook_public_id
                 WHERE event.id = $1 AND event.target_type <> 'REPORT' FOR SHARE OF event`,
                    [body.auditEventPublicId, id],
                  );
                  if (nested.rowCount !== 1) safetyError(404, 'RESOURCE_NOT_FOUND');
                }
                await client.query(
                  'INSERT INTO administrative_report_event (report_public_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                  [id, body.auditEventPublicId],
                );
                return {
                  value: {},
                  newState: { auditEventPublicId: body.auditEventPublicId, status: 'EVENT_LINKED' },
                };
              }
              const page: unknown = body.page ?? 1;
              if (
                typeof page !== 'number' ||
                !Number.isSafeInteger(page) ||
                page < 1 ||
                page > 100000
              )
                safetyError(400, 'INVALID_REPORT_HISTORY');
              const filter: string = `event.action <> 'ADMIN_REPORT_HISTORY_VIEWED' AND (event.related_report_public_id = $1 OR EXISTS (
            SELECT 1 FROM administrative_report_event link WHERE link.report_public_id = $1 AND link.event_id = event.id))`;
              const events: QueryResult = await client.query(
                `SELECT event.id AS "publicId", event.created_at AS "createdAt", event.actor_principal_id AS "actorPrincipalId", event.action,
              event.target_type AS "targetType", event.target_public_id AS "targetPublicId", event.cookbook_public_id AS "cookbookPublicId",
              event.revision_public_id AS "revisionPublicId", event.media_public_id AS "mediaPublicId", event.reason,
              event.previous_state AS "previousState", event.new_state AS "newState", event.request_id AS "requestId", event.outcome,
              CASE WHEN event.target_type = 'COOKBOOK' AND live_cookbook.id IS NOT NULL THEN '/admin/tenants/' || live_cookbook.public_id || '/inspection'
                WHEN event.target_type = 'RECIPE' AND live_parent.public_id = event.cookbook_public_id THEN
                  '/admin/tenants/' || live_parent.public_id || CASE WHEN live_revision.public_id IS NOT NULL THEN '/recipes/' || live_recipe.public_id || '/revisions/' || live_revision.public_id ELSE '/inspection' END
                WHEN event.target_type = 'USER' AND live_account.id IS NOT NULL THEN '/admin/users#user-' || live_account.public_id
                ELSE NULL END AS "recheckPath"
              FROM administrative_audit_event event
              LEFT JOIN tenant live_cookbook ON event.target_type = 'COOKBOOK' AND live_cookbook.public_id = event.target_public_id
              LEFT JOIN recipe live_recipe ON event.target_type = 'RECIPE' AND live_recipe.public_id = event.target_public_id
              LEFT JOIN tenant live_parent ON live_parent.id = live_recipe.tenant_id
              LEFT JOIN LATERAL (SELECT public_id FROM recipe_revision WHERE recipe_id = live_recipe.id
                ORDER BY (public_id = event.revision_public_id) DESC NULLS LAST, revision_no DESC LIMIT 1) live_revision ON true
              LEFT JOIN user_account live_account ON event.target_type = 'USER' AND live_account.public_id = event.target_public_id AND live_account.deleted_at IS NULL
              WHERE ${filter} ORDER BY event.created_at DESC, event.id DESC LIMIT 25 OFFSET $2`,
                [id, (page - 1) * 25],
              );
              const count: QueryResult<{ total: number }> = await client.query(
                `SELECT count(*)::integer AS total FROM administrative_audit_event event WHERE ${filter}`,
                [id],
              );
              const notices: QueryResult = await client.query(
                `SELECT notice.public_id AS "publicId", account.public_id AS "recipientPublicId", notice.recipient_role AS "recipientRole",
              notice.message, notice.review_instructions AS "reviewInstructions", notice.delivery_status AS "deliveryStatus",
              notice.created_at AS "createdAt", notice.delivered_at AS "deliveredAt"
              FROM administrative_report_notice notice JOIN user_account account ON account.id = notice.recipient_user_id
              WHERE notice.report_public_id = $1 ORDER BY notice.created_at DESC, notice.public_id DESC LIMIT 25 OFFSET $2`,
                [id, (page - 1) * 25],
              );
              const noticeCount: QueryResult<{ total: number }> = await client.query(
                'SELECT count(*)::integer AS total FROM administrative_report_notice WHERE report_public_id = $1',
                [id],
              );
              return {
                value: {
                  events: events.rows,
                  notices: notices.rows,
                  page,
                  pageSize: 25,
                  totalEvents: count.rows[0]!.total,
                  totalNotices: noticeCount.rows[0]!.total,
                },
              };
            },
          );
          if (result) return history ? result.value : reply.code(204).send();
        } catch (error: unknown) {
          return sendSafetyError(reply, error);
        }
      },
    );
  }
}
