import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrateDatabase } from '@shadowcook/db';
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
