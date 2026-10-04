import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Migration } from './types.js';

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function loadSqlMigration(id: string, migrationUrl: URL): Migration {
  const sql: string = readFileSync(migrationUrl, 'utf8');

  return {
    id,
    checksum: checksum(sql),
    sql,
  };
}
