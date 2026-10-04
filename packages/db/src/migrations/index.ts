import { loadSqlMigration } from './load-sql-migration.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [
  loadSqlMigration('0001_initial_schema', new URL('./0001_initial_schema.sql', import.meta.url)),
];
