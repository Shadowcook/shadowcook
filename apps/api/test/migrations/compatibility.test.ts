import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrateDatabase, MigrationCompatibilityError } from '@shadowcook/db';
import { Pool, type QueryResult } from 'pg';
import { discoverSqlMigrations } from '../../../../packages/db/src/migrations/discover-sql-migrations.js';
import type { Migration } from '../../../../packages/db/src/migrations/types.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface LedgerRow {
  id: string;
  checksum: string;
  applied_at: Date;
}

let database: DisposablePostgresDatabase;
const migrations: readonly Migration[] = discoverSqlMigrations();
const baseline: Migration = migrations[0]!;
const pending: Migration = migrations[1]!;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
});

after(async (): Promise<void> => {
  if (database !== undefined) await database.close();
});

beforeEach(async (): Promise<void> => {
  await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
});

async function createLedger(): Promise<void> {
  await database.pool.query(`CREATE TABLE application_schema_migration (
    id text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function recordMigration(id: string, checksum: string): Promise<void> {
  await database.pool.query(
    'INSERT INTO application_schema_migration (id, checksum) VALUES ($1, $2)',
    [id, checksum],
  );
}

async function ledger(): Promise<LedgerRow[]> {
  const result: QueryResult<LedgerRow> = await database.pool.query<LedgerRow>(
    'SELECT id, checksum, applied_at FROM application_schema_migration ORDER BY id',
  );
  return result.rows;
}

async function assertLockReleased(): Promise<void> {
  // A different session detects leaked session locks, even if the migration client is idle.
  const observer: Pool = new Pool({ connectionString: database.databaseUrl, max: 1 });
  try {
    const result: QueryResult<{ acquired: boolean }> = await observer.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      ['shadowcook-schema-migration'],
    );
    assert.equal(result.rows[0]?.acquired, true);
    await observer.query('SELECT pg_advisory_unlock(hashtext($1))', [
      'shadowcook-schema-migration',
    ]);
    assert.equal(database.pool.idleCount, database.pool.totalCount);
  } finally {
    await observer.end();
  }
}

async function assertOnlyLedgerExists(): Promise<void> {
  const result: QueryResult<{ tablename: string }> = await database.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  assert.deepEqual(result.rows, [{ tablename: 'application_schema_migration' }]);
}

async function applyBaseline(): Promise<void> {
  await createLedger();
  await database.pool.query(baseline.sql);
  await recordMigration(baseline.id, baseline.checksum);
}

async function hasPendingColumn(): Promise<boolean> {
  const result: QueryResult<{ exists: boolean }> = await database.pool.query(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant' AND column_name = 'name_reset_required'
  ) AS exists`);
  return result.rows[0]!.exists;
}

test('unknown applied IDs reject all pending SQL and leave the ledger unchanged', async (): Promise<void> => {
  await createLedger();
  await recordMigration('99999999999998_unknown', 'unknown');
  await recordMigration('99999999999999_unknown', 'unknown');
  const original: LedgerRow[] = await ledger();
  await assert.rejects(migrateDatabase(database.pool), (error: unknown): boolean => {
    assert.ok(error instanceof MigrationCompatibilityError);
    assert.match(error.message, /99999999999998_unknown/);
    assert.match(error.message, /99999999999999_unknown/);
    return true;
  });
  await assertOnlyLedgerExists();
  assert.deepEqual(await ledger(), original);
  await assertLockReleased();
});

test('a later checksum mismatch rejects an earlier pending migration before executing SQL', async (): Promise<void> => {
  await createLedger();
  await recordMigration(pending.id, 'changed-checksum');
  const original: LedgerRow[] = await ledger();
  await assert.rejects(migrateDatabase(database.pool), (error: unknown): boolean => {
    assert.ok(error instanceof MigrationCompatibilityError);
    assert.match(error.message, /checksum mismatch/);
    assert.ok(error.message.includes(pending.id));
    assert.doesNotMatch(error.message, /newer|Downgrades/);
    return true;
  });
  await assertOnlyLedgerExists();
  assert.deepEqual(await ledger(), original);
  await assertLockReleased();
});

test('a fresh database migrates in order and matching history can run repeatedly', async (): Promise<void> => {
  await migrateDatabase(database.pool);
  const original: LedgerRow[] = await ledger();
  assert.deepEqual(
    original.map((row: LedgerRow): string => row.id),
    migrations.map((migration: Migration): string => migration.id),
  );
  assert.equal(await hasPendingColumn(), true);
  await migrateDatabase(database.pool);
  assert.deepEqual(await ledger(), original);
  await assertLockReleased();
});

test('matching applied history permits forward migration without reapplying the baseline', async (): Promise<void> => {
  await applyBaseline();
  const original: LedgerRow[] = await ledger();
  assert.equal(await hasPendingColumn(), false);
  await migrateDatabase(database.pool);
  assert.deepEqual((await ledger())[0], original[0]);
  assert.equal(await hasPendingColumn(), true);
  assert.equal((await ledger()).length, migrations.length);
  await assertLockReleased();
});

test('older application release metadata does not restrict a compatible schema', async (): Promise<void> => {
  await migrateDatabase(database.pool);
  const original: LedgerRow[] = await ledger();
  const originalVersion: string | undefined = process.env.npm_package_version;
  try {
    process.env.npm_package_version = '0.0.1';
    await migrateDatabase(database.pool);
    assert.deepEqual(await ledger(), original);
  } finally {
    if (originalVersion === undefined) delete process.env.npm_package_version;
    else process.env.npm_package_version = originalVersion;
  }
  await assertLockReleased();
});

test('failed ledger insertion rolls back migration DDL and releases the advisory lock', async (): Promise<void> => {
  await applyBaseline();
  const original: LedgerRow[] = await ledger();
  await database.pool.query(`ALTER TABLE application_schema_migration
    ADD CONSTRAINT reject_pending CHECK (id = '${baseline.id}')`);
  await assert.rejects(migrateDatabase(database.pool), /reject_pending/);
  assert.equal(await hasPendingColumn(), false);
  assert.deepEqual(await ledger(), original);
  await assertLockReleased();
});

for (const failure of ['unknown', 'checksum'] as const) {
  test(`API exits fatally before bootstrap, seeds, or listening for ${failure} history`, async (): Promise<void> => {
    await migrateDatabase(database.pool);
    if (failure === 'unknown') await recordMigration('99999999999999_unknown', 'unknown');
    else
      await database.pool.query(
        'UPDATE application_schema_migration SET checksum = $1 WHERE id = $2',
        ['changed', pending.id],
      );
    const original: LedgerRow[] = await ledger();
    const child: ChildProcess = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        fileURLToPath(new URL('../fixtures/reject-http-listener.mjs', import.meta.url)),
        fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: database.databaseUrl,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '49199',
          INSTANCE_SECRET_KEY: '',
          INSTANCE_SECRET_KEY_FILE: '',
          TURNSTILE_SECRET: '',
          TURNSTILE_SECRET_FILE: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr: string = '';
    let stdout: string = '';
    child.stderr!.setEncoding('utf8').on('data', (chunk: string): void => {
      stderr += chunk;
    });
    child.stdout!.setEncoding('utf8').on('data', (chunk: string): void => {
      stdout += chunk;
    });
    const timer: NodeJS.Timeout = setTimeout((): void => {
      child.kill('SIGKILL');
    }, 20_000);
    try {
      const exitCode: number | null = await new Promise(
        (resolve: (code: number | null) => void, reject: (error: Error) => void): void => {
          child.once('error', reject);
          child.once('close', resolve);
        },
      );
      assert.equal(exitCode, 1, stderr);
      assert.match(stderr, /\*\*\* FATAL \*\*\*/);
      if (failure === 'unknown') {
        assert.match(
          stderr,
          /Database version newer than current program version\.\nDowngrades are not supported\.\nPlease update to a newer version\./,
        );
        assert.match(stderr, /99999999999999_unknown/);
      } else {
        assert.match(stderr, /Database migration checksum mismatch/);
        assert.ok(stderr.includes(pending.id));
        assert.doesNotMatch(stderr, /Downgrades are not supported/);
      }
      assert.doesNotMatch(
        stderr + stdout,
        /UNEXPECTED_HTTP_LISTENER|Bootstrap administrator created|Server listening/,
      );
      assert.ok(!stderr.includes(database.databaseUrl));
      assert.deepEqual(await ledger(), original);
      for (const table of ['application_seed', 'principal', 'unit']) {
        const result: QueryResult<{ count: number }> = await database.pool.query(
          `SELECT count(*)::integer AS count FROM ${table}`,
        );
        assert.equal(result.rows[0]?.count, 0, `${table} must remain empty`);
      }
      await assertLockReleased();
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
}
