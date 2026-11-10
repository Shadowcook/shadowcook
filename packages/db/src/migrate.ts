import type { Pool, PoolClient, QueryResult } from 'pg';
import { MigrationCompatibilityError } from './migrations/compatibility-error.js';
import { discoverSqlMigrations } from './migrations/discover-sql-migrations.js';
import type { Migration } from './migrations/types.js';

interface AppliedMigration {
  id: string;
  checksum: string;
}

const migrationTableSql = `
CREATE TABLE IF NOT EXISTS application_schema_migration (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`;

export async function migrateDatabase(pool: Pool): Promise<void> {
  const migrations: readonly Migration[] = discoverSqlMigrations();
  const client: PoolClient = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['shadowcook-schema-migration']);
    await client.query(migrationTableSql);
    const appliedResult: QueryResult<AppliedMigration> = await client.query<AppliedMigration>(
      'SELECT id, checksum FROM application_schema_migration ORDER BY id',
    );
    const appliedById: Map<string, AppliedMigration> = new Map();
    const migrationsById: Map<string, Migration> = new Map(
      migrations.map((migration: Migration): [string, Migration] => [migration.id, migration]),
    );
    const unknownMigrationIds: string[] = appliedResult.rows
      .filter((applied: AppliedMigration): boolean => !migrationsById.has(applied.id))
      .map((applied: AppliedMigration): string => applied.id);

    if (unknownMigrationIds.length > 0) {
      throw new MigrationCompatibilityError(
        'Database version newer than current program version.\n' +
          'Downgrades are not supported.\n' +
          'Please update to a newer version.\n' +
          `Unknown applied migrations: ${unknownMigrationIds.join(', ')}`,
      );
    }

    for (const appliedMigration of appliedResult.rows) {
      if (migrationsById.get(appliedMigration.id)?.checksum !== appliedMigration.checksum) {
        throw new MigrationCompatibilityError(
          'Database migration checksum mismatch.\n' +
            `Migration: ${appliedMigration.id}\n` +
            'API startup aborted to prevent unsafe database changes.',
        );
      }
      appliedById.set(appliedMigration.id, appliedMigration);
    }

    for (const migration of migrations) {
      await applyMigration(client, migration, appliedById.get(migration.id));
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        'shadowcook-schema-migration',
      ]);
    } finally {
      client.release();
    }
  }
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
  appliedMigration: AppliedMigration | undefined,
): Promise<void> {
  if (appliedMigration !== undefined) {
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query('INSERT INTO application_schema_migration (id, checksum) VALUES ($1, $2)', [
      migration.id,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}
