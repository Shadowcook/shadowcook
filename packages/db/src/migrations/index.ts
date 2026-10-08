import { loadSqlMigration } from './load-sql-migration.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [
  loadSqlMigration(
    '20261006000000_initial_schema',
    new URL('./20261006000000_initial_schema.sql', import.meta.url),
  ),
  loadSqlMigration(
    '20261006232324_beta-1',
    new URL('./20261006232324_beta-1.sql', import.meta.url),
  ),
  loadSqlMigration(
    '20261008105648_beta_2_tenant_local_ingredients',
    new URL('./20261008105648_beta_2_tenant_local_ingredients.sql', import.meta.url),
  ),
];
