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
  }>('SELECT dimension, base_factor::text, base_offset::text FROM unit ORDER BY id');

  assert.equal(result.rows.length, 19);
  for (const unit of result.rows) {
    assert.notEqual(unit.dimension, null);
    assert.notEqual(unit.base_factor, null);
    assert.notEqual(unit.base_offset, null);
  }
});

test('normalized recipe search transliterates text, separates words, and ranks matches', async (): Promise<void> => {
  const normalizationResult = await database.pool.query<{ normalized: string }>(
    "SELECT normalize_search_text('Çılbır, Schröder, Crème brûlée & Pan-Pizza') AS normalized",
  );
  assert.equal(normalizationResult.rows[0]?.normalized, 'cilbir schroder creme brulee pan pizza');

  const rankResult = await database.pool.query<{
    exact_rank: number;
    phrase_rank: number;
    title_token_rank: number;
    summary_phrase_rank: number;
    summary_token_rank: number;
  }>(
    `SELECT recipe_search_match_rank('Pan-Pizza', NULL, 'pan pizza') AS exact_rank,
      recipe_search_match_rank('Classic Pan Pizza', NULL, 'pan pizza') AS phrase_rank,
      recipe_search_match_rank('Pizza for a pan', NULL, 'pan pizza') AS title_token_rank,
      recipe_search_match_rank('Focaccia', 'A Pan-Pizza classic', 'pan pizza') AS summary_phrase_rank,
      recipe_search_match_rank('Focaccia', 'Pizza for a pan', 'pan pizza') AS summary_token_rank`,
  );
  assert.deepEqual(rankResult.rows[0], {
    exact_rank: 0,
    phrase_rank: 1,
    title_token_rank: 2,
    summary_phrase_rank: 3,
    summary_token_rank: 4,
  });
});
