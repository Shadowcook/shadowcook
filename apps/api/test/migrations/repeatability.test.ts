import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrateDatabase } from '@shadowcook/db';
import { seedInitialDeployment } from '../../src/initial-deployment-seed.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
});

after(async (): Promise<void> => {
  if (database !== undefined) await database.close();
});

test('migrations are repeatable without changing the migration ledger', async (): Promise<void> => {
  const beforeResult = await database.pool.query<{ id: string; checksum: string }>(
    'SELECT id, checksum FROM application_schema_migration ORDER BY id',
  );

  await migrateDatabase(database.pool);

  const afterResult = await database.pool.query<{ id: string; checksum: string }>(
    'SELECT id, checksum FROM application_schema_migration ORDER BY id',
  );
  assert.deepEqual(afterResult.rows, beforeResult.rows);
  assert.ok(afterResult.rows.length > 0);
});

test('initial deployment seed stores complete conversions for all standard units', async (): Promise<void> => {
  await seedInitialDeployment(database.pool);

  const result = await database.pool.query<{
    dimension: string | null;
    base_factor: string | null;
    base_offset: string | null;
  }>(
    'SELECT dimension, base_factor::text, base_offset::text FROM unit ORDER BY id',
  );

  assert.equal(result.rows.length, 19);
  for (const unit of result.rows) {
    assert.notEqual(unit.dimension, null);
    assert.notEqual(unit.base_factor, null);
    assert.notEqual(unit.base_offset, null);
  }
});
