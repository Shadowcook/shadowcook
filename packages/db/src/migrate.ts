import type { Pool, PoolClient } from 'pg';
import { migrations } from './migrations/index.js';
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
  const client: PoolClient = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['shadowcook-schema-migration']);
    await client.query(migrationTableSql);
    const appliedResult = await client.query<AppliedMigration>(
      'SELECT id, checksum FROM application_schema_migration ORDER BY id',
    );
    const appliedById: Map<string, AppliedMigration> = new Map();

    for (const appliedMigration of appliedResult.rows) {
      appliedById.set(appliedMigration.id, appliedMigration);
    }

    for (const migration of migrations) {
      await applyMigration(client, migration, appliedById.get(migration.id));
    }

    const knownMigrationIds: Set<string> = new Set(migrations.map((migration) => migration.id));
    for (const appliedMigration of appliedResult.rows) {
      if (!knownMigrationIds.has(appliedMigration.id)) {
        throw new Error(`Database contains unknown migration '${appliedMigration.id}'.`);
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['shadowcook-schema-migration']);
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
    if (appliedMigration.checksum !== migration.checksum) {
      throw new Error(`Checksum mismatch for migration '${migration.id}'.`);
    }
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO application_schema_migration (id, checksum) VALUES ($1, $2)',
      [migration.id, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}
