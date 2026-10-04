import type { Pool, PoolClient } from 'pg';
import { applyDevelopmentBaselineSeed, developmentBaselineSeedId } from './development-baseline.js';
import { migrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

interface AppliedMigration {
  id: string;
  checksum: string;
}

export interface MigrateDatabaseOptions {
  applyDevelopmentBaseline: boolean;
}

const initialMigrationId: string = '0001_initial_schema';

const migrationTableSql = `
CREATE TABLE IF NOT EXISTS application_schema_migration (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`;

export async function migrateDatabase(
  pool: Pool,
  options: MigrateDatabaseOptions = { applyDevelopmentBaseline: false },
): Promise<void> {
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
      if (migration.id === initialMigrationId && options.applyDevelopmentBaseline) {
        await assertDevelopmentBaselineOrder(client, appliedById);
        await applyDevelopmentBaselineSeed(client);
      }
    }

    const knownMigrationIds: Set<string> = new Set(migrations.map((migration) => migration.id));
    for (const appliedMigration of appliedResult.rows) {
      if (!knownMigrationIds.has(appliedMigration.id)) {
        throw new Error(`Database contains unknown migration '${appliedMigration.id}'.`);
      }
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

async function assertDevelopmentBaselineOrder(
  client: PoolClient,
  appliedById: ReadonlyMap<string, AppliedMigration>,
): Promise<void> {
  const hasLaterMigration: boolean = migrations.some(
    (migration: Migration): boolean =>
      migration.id !== initialMigrationId && appliedById.has(migration.id),
  );
  if (!hasLaterMigration) return;

  const result = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM application_seed WHERE id = $1) AS exists',
    [developmentBaselineSeedId],
  );
  if (result.rows[0]?.exists !== true) {
    throw new Error(
      'The development baseline must be applied after 0001_initial_schema and before later migrations.',
    );
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
