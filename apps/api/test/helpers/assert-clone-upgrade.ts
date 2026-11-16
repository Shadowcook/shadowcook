import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import { migrateDatabase } from '../../../../packages/db/src/migrate.js';
import { discoverSqlMigrations } from '../../../../packages/db/src/migrations/discover-sql-migrations.js';

const databaseUrl: string | undefined = process.env.CLONE_TEST_DATABASE_URL;
assert.ok(databaseUrl);
const pool: Pool = new Pool({ connectionString: databaseUrl });
try {
  const before: QueryResult<{ id: string; checksum: string; applied_at: Date }> = await pool.query<{
    id: string;
    checksum: string;
    applied_at: Date;
  }>('SELECT id, checksum, applied_at FROM application_schema_migration ORDER BY id');
  assert.equal(before.rows.length, 1);
  assert.equal(
    (await pool.query("SELECT to_regclass('public.administrative_email_recovery') AS relation"))
      .rows[0].relation,
    null,
  );
  await migrateDatabase(pool);
  const after: QueryResult<{ id: string; checksum: string; applied_at: Date }> = await pool.query<{
    id: string;
    checksum: string;
    applied_at: Date;
  }>('SELECT id, checksum, applied_at FROM application_schema_migration ORDER BY id');
  assert.equal(after.rows.length, discoverSqlMigrations().length);
  assert.deepEqual(after.rows[0], before.rows[0]);
  assert.notEqual(
    (await pool.query("SELECT to_regclass('public.administrative_email_recovery') AS relation"))
      .rows[0].relation,
    null,
  );
  assert.equal(
    (await pool.query('SELECT value FROM legacy_business')).rows[0].value,
    'unchanged upgrade fixture',
  );
  console.log(
    'PASS: cloned baseline upgrades with the real migration runner and preserves applied migration history',
  );
} finally {
  await pool.end();
}
