import type { Pool, QueryResult } from 'pg';

export function validateAuditRetentionDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error('Audit retention must be an integer between 1 and 3650 days.');
  }
}

// Operator-only maintenance: no web/API route exposes policy changes or pruning.
export async function setAuditRetentionDays(pool: Pool, days: number): Promise<void> {
  validateAuditRetentionDays(days);
  const result: QueryResult = await pool.query(
    'UPDATE administrative_audit_policy SET retention_days = $1 WHERE singleton = true',
    [days],
  );
  if (result.rowCount !== 1) throw new Error('Administrative audit policy is missing.');
}

export async function pruneAdministrativeAudit(pool: Pool): Promise<number> {
  const result: QueryResult = await pool.query(`DELETE FROM administrative_audit_event
    WHERE created_at < statement_timestamp() - (
      SELECT retention_days * interval '24 hours' FROM administrative_audit_policy WHERE singleton = true
    )`);
  return result.rowCount ?? 0;
}
