import { loadSqlMigration } from './load-sql-migration.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [
  loadSqlMigration('0001_initial_schema', new URL('./0001_initial_schema.sql', import.meta.url)),
  loadSqlMigration('0002_beta-1', new URL('./0002_beta-1.sql', import.meta.url)),
  loadSqlMigration('0003_beta_2', new URL('./0003_beta_2.sql', import.meta.url)),
  loadSqlMigration(
    '0004_beta_2_featured_existing_recipes',
    new URL('./0004_beta_2_featured_existing_recipes.sql', import.meta.url),
  ),
  loadSqlMigration(
    '0005_beta_2_frontpage_recipe_count',
    new URL('./0005_beta_2_frontpage_recipe_count.sql', import.meta.url),
  ),
  loadSqlMigration(
    '0006_beta_2_frontpage_heading',
    new URL('./0006_beta_2_frontpage_heading.sql', import.meta.url),
  ),
];
