import type { Pool, PoolClient, QueryResult } from 'pg';
import { sendTemplatedInstanceMail } from '../mail/service.js';

export async function deliverReportNotifications(
  pool: Pool,
  secret: Buffer | null,
  origin: string,
  reportId: string | null = null,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result: QueryResult<{
      public_id: string;
      target_type: string;
      target_public_id: string;
      reason: string;
      description: string;
      recipient_email: string;
    }> = await client.query(
      `SELECT r.public_id, r.target_type, r.target_public_id, r.reason, r.description, settings.recipient_email
       FROM content_report_notification n JOIN content_report r ON r.public_id = n.report_public_id
       CROSS JOIN instance_report_settings settings
       WHERE n.sent_at IS NULL AND settings.recipient_email IS NOT NULL
         AND ($1::uuid IS NULL OR r.public_id = $1) AND n.next_attempt_at <= now()
       ORDER BY n.next_attempt_at LIMIT 10 FOR UPDATE OF n SKIP LOCKED`,
      [reportId],
    );
    for (const report of result.rows) {
      let sent: boolean = false;
      try {
        sent = await sendTemplatedInstanceMail(
          client,
          secret,
          report.recipient_email,
          'CONTENT_REPORT',
          {
            report_id: report.public_id,
            target_type: report.target_type,
            target_id: report.target_public_id,
            reason: report.reason,
            description: report.description,
            action_url: `${origin}/admin/reports/${report.public_id}`,
          },
        );
      } catch {
        // A failed delivery remains queued; report text is never written to logs.
      }
      await client.query(
        `UPDATE content_report_notification SET attempts = attempts + 1,
        sent_at = CASE WHEN $2 THEN now() ELSE NULL END, next_attempt_at = now() + interval '5 minutes'
        WHERE report_public_id = $1`,
        [report.public_id, sent],
      );
    }
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
