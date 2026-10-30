import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { requireInstancePermission } from '../admin/authorization.js';
import { isRecord, isUuid, parseReportUpdate, reportStatuses, type ReportUpdate } from './model.js';

const administratorSql: string = `SELECT u.id, u.public_id AS "publicId", u.display_name AS "displayName"
  FROM user_account u JOIN principal ON principal.id = u.principal_id
  WHERE u.disabled_at IS NULL AND u.deleted_at IS NULL AND principal.disabled_at IS NULL AND EXISTS (
    SELECT 1 FROM principal_instance_role r JOIN instance_role_permission p ON p.instance_role_id = r.instance_role_id
    WHERE r.principal_id = u.principal_id AND p.permission_code = 'instance:administer')`;

const reportSelectSql: string = `SELECT r.public_id AS "publicId", r.target_type AS "targetType", r.target_public_id AS "targetPublicId",
  COALESCE(revision.title, target_user.display_name, cookbook.display_name) AS "targetName",
  CASE WHEN r.target_type = 'RECIPE' AND recipe.id IS NOT NULL THEN '/' || recipe_tenant.slug || '/recipes/' || recipe.slug
       WHEN r.target_type = 'COOKBOOK' AND cookbook.id IS NOT NULL THEN '/' || cookbook.slug
       WHEN r.target_type = 'USER' AND target_user.id IS NOT NULL THEN '/admin/users#user-' || target_user.public_id ELSE NULL END AS "targetUrl",
  reporter.display_name AS "reporterName", reporter.email AS "reporterEmail",
  r.reason, r.description, r.status, r.result, r.result_note AS "resultNote",
  admin.public_id AS "assignedAdminPublicId", admin.display_name AS "assignedAdminName",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt", n.sent_at AS "notificationSentAt"
  FROM content_report r JOIN user_account reporter ON reporter.id = r.reporter_user_id
  LEFT JOIN user_account admin ON admin.id = r.assigned_admin_user_id
  LEFT JOIN recipe ON r.target_type = 'RECIPE' AND recipe.public_id = r.target_public_id
  LEFT JOIN recipe_revision revision ON revision.id = recipe.published_revision_id
  LEFT JOIN tenant recipe_tenant ON recipe_tenant.id = recipe.tenant_id
  LEFT JOIN user_account target_user ON r.target_type = 'USER' AND target_user.public_id = r.target_public_id
  LEFT JOIN tenant cookbook ON r.target_type = 'COOKBOOK' AND cookbook.public_id = r.target_public_id
  JOIN content_report_notification n ON n.report_public_id = r.public_id`;

export function registerAdminReportRoutes(api: FastifyInstance, pool: Pool): void {
  api.get(
    '/admin/report-settings',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const result: QueryResult<{ recipientEmail: string | null }> = await pool.query(
        'SELECT recipient_email AS "recipientEmail" FROM instance_report_settings WHERE singleton = true',
      );
      return result.rows[0];
    },
  );
  api.put(
    '/admin/report-settings',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const principalId: string | null = await requireInstancePermission(
        pool,
        request,
        reply,
        'instance:administer',
      );
      if (principalId === null) return;
      const body: unknown = request.body;
      if (
        !isRecord(body) ||
        Object.keys(body).some((key: string): boolean => key !== 'recipientEmail') ||
        !(
          body.recipientEmail === null ||
          (typeof body.recipientEmail === 'string' &&
            body.recipientEmail.length <= 254 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipientEmail))
        )
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT_SETTINGS', error: 'The report address is invalid.' });
      await pool.query(
        'UPDATE instance_report_settings SET recipient_email = $1, updated_by_principal_id = $2, updated_at = now() WHERE singleton = true',
        [body.recipientEmail, principalId],
      );
      return reply.code(204).send();
    },
  );
  api.get(
    '/admin/reports',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const query: { status?: unknown; page?: unknown } = request.query as {
        status?: unknown;
        page?: unknown;
      };
      const page: number = query.page === undefined ? 1 : Number(query.page);
      const status: string | null = query.status === undefined ? null : String(query.status);
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        (status !== null && !reportStatuses.includes(status))
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT_FILTER', error: 'The report filter is invalid.' });
      const count: QueryResult<{ total: number }> = await pool.query(
        'SELECT count(*)::integer AS total FROM content_report WHERE ($1::text IS NULL OR status = $1)',
        [status],
      );
      const reports: QueryResult = await pool.query(
        `${reportSelectSql} WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC, r.public_id LIMIT 50 OFFSET $2`,
        [status, (page - 1) * 50],
      );
      const administrators: QueryResult = await pool.query(
        `SELECT "publicId", "displayName" FROM (${administratorSql}) administrators ORDER BY "displayName", "publicId"`,
      );
      return {
        reports: reports.rows,
        administrators: administrators.rows,
        page,
        pageSize: 50,
        totalReports: count.rows[0]!.total,
      };
    },
  );
  api.get(
    '/admin/reports/:publicId',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const publicId: unknown = (request.params as { publicId?: unknown }).publicId;
      if (!isUuid(publicId))
        return reply.code(400).send({ code: 'INVALID_REPORT', error: 'The report ID is invalid.' });
      const report: QueryResult = await pool.query(`${reportSelectSql} WHERE r.public_id = $1`, [
        publicId,
      ]);
      if (report.rows[0] === undefined)
        return reply
          .code(404)
          .send({ code: 'REPORT_NOT_FOUND', error: 'The report was not found.' });
      const administrators: QueryResult = await pool.query(
        `SELECT "publicId", "displayName" FROM (${administratorSql}) administrators ORDER BY "displayName", "publicId"`,
      );
      return { report: report.rows[0], administrators: administrators.rows };
    },
  );
  api.put(
    '/admin/reports/:publicId',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const publicId: unknown = (request.params as { publicId?: unknown }).publicId;
      const input: ReportUpdate | null = parseReportUpdate(request.body);
      if (!isUuid(publicId) || input === null)
        return reply
          .code(400)
          .send({ code: 'INVALID_REPORT_UPDATE', error: 'The report update is invalid.' });
      // The update and active-administrator check share one statement.
      const updated: QueryResult = await pool.query(
        `UPDATE content_report SET status = $2, result = $3, result_note = $4,
      assigned_admin_user_id = (SELECT id FROM (${administratorSql}) administrators WHERE "publicId" = $5), updated_at = now()
      WHERE public_id = $1 AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM (${administratorSql}) administrators WHERE "publicId" = $5)) RETURNING public_id`,
        [publicId, input.status, input.result, input.resultNote, input.assignedAdminPublicId],
      );
      if (updated.rowCount === 0) {
        const exists: QueryResult = await pool.query(
          'SELECT 1 FROM content_report WHERE public_id = $1',
          [publicId],
        );
        return reply.code(exists.rowCount === 0 ? 404 : 400).send({
          code: exists.rowCount === 0 ? 'REPORT_NOT_FOUND' : 'INVALID_REPORT_ASSIGNEE',
          error: 'The report or administrator is unavailable.',
        });
      }
      return reply.code(204).send();
    },
  );
}
