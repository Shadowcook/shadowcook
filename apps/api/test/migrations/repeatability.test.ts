import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { migrateDatabase } from '@shadowcook/db';
import type { PoolClient, QueryResult } from 'pg';
import { seedInitialDeployment } from '../../src/initial-deployment-seed.js';
import { createTestTenant, type TestTenant } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;

interface MigratedUnitRow {
  name: string;
  symbol: string;
  translated_name: string;
  translated_symbol: string;
}

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

test('the contributor migration backfills existing creators and cascades discarded revision memberships', async (): Promise<void> => {
  const tenant: TestTenant = await createTestTenant(database.pool, 'contributor-backfill');
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const principal: QueryResult<{ id: string }> = await client.query<{ id: string }>(
      "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
    );
    const recipe: QueryResult<{ id: string }> = await client.query<{ id: string }>(
      "INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, gen_random_uuid(), 'backfill') RETURNING id",
      [tenant.id],
    );
    const revision: QueryResult<{ id: string }> = await client.query<{ id: string }>(
      "INSERT INTO recipe_revision (recipe_id, revision_no, status, title, created_by_principal_id) VALUES ($1, 1, 'DRAFT', 'Existing draft', $2) RETURNING id",
      [recipe.rows[0]!.id, principal.rows[0]!.id],
    );
    await client.query('DROP TABLE recipe_revision_contributor');
    const sql: string = readFileSync(
      new URL(
        '../../../../packages/db/src/migrations/sql/20261013205649_beta_2_recipe_contributors.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query(sql);
    const contributions: QueryResult<{ recipe_revision_id: string; principal_id: string }> =
      await client.query<{ recipe_revision_id: string; principal_id: string }>(
        'SELECT recipe_revision_id, principal_id FROM recipe_revision_contributor WHERE recipe_revision_id = $1',
        [revision.rows[0]!.id],
      );
    assert.deepEqual(contributions.rows, [
      { recipe_revision_id: revision.rows[0]!.id, principal_id: principal.rows[0]!.id },
    ]);
    await client.query('DELETE FROM recipe_revision WHERE id = $1', [revision.rows[0]!.id]);
    assert.equal(
      (
        await client.query(
          'SELECT 1 FROM recipe_revision_contributor WHERE recipe_revision_id = $1',
          [revision.rows[0]!.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
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

test('unit translation migration preserves existing default edits and populates German versions', async (): Promise<void> => {
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE unit_translation');
    await client.query(
      "UPDATE unit SET name = 'custom teaspoon', symbol = 'custom tsp' WHERE localization_key = 'unit.volume.teaspoon.metric'",
    );
    const sql: string = readFileSync(
      new URL(
        '../../../../packages/db/src/migrations/sql/20261011191926_beta_2_unit_translations.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query(sql);
    const result: QueryResult<MigratedUnitRow> = await client.query<MigratedUnitRow>(
      `SELECT unit.name, unit.symbol, translation.name AS translated_name, translation.symbol AS translated_symbol
       FROM unit INNER JOIN unit_translation AS translation ON translation.unit_id = unit.id
       WHERE unit.localization_key = 'unit.volume.teaspoon.metric' AND translation.locale = 'de'`,
    );
    assert.deepEqual(result.rows[0], {
      name: 'custom teaspoon',
      symbol: 'custom tsp',
      translated_name: 'Teelöffel',
      translated_symbol: 'TL',
    });
    const count: QueryResult<{ count: number }> = await client.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM unit_translation',
    );
    assert.equal(count.rows[0]?.count, 19);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('variant metadata migration copies legacy values to every variant and removes revision columns', async (): Promise<void> => {
  const tenant: TestTenant = await createTestTenant(database.pool, 'variant-facts-backfill');
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const recipe: QueryResult<{ id: string }> = await client.query(
      "INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, gen_random_uuid(), 'variant-backfill') RETURNING id",
      [tenant.id],
    );
    const revision: QueryResult<{ id: string }> = await client.query(
      "INSERT INTO recipe_revision (recipe_id, revision_no, status, title) VALUES ($1, 1, 'DRAFT', 'Existing') RETURNING id",
      [recipe.rows[0]!.id],
    );
    for (const isDefault of [true, false])
      await client.query(
        'INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default, is_visible) VALUES ($1, gen_random_uuid(), $2, $2, $3, true)',
        [revision.rows[0]!.id, isDefault ? 'default' : 'alternative', isDefault],
      );
    await client.query(
      'ALTER TABLE recipe_variant DROP COLUMN difficulty, DROP COLUMN total_minutes, DROP COLUMN active_minutes, DROP COLUMN kcal, DROP COLUMN servings, DROP COLUMN utensils, DROP COLUMN diet',
    );
    await client.query(
      readFileSync(
        new URL(
          '../../../../packages/db/src/migrations/sql/20261020080239_beta_2_recipe_metadata.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await client.query(
      "UPDATE recipe_revision SET diet = 'VEGAN', total_minutes = 90, active_minutes = 20, kcal = 800, servings = 4, utensils = 'Whisk', difficulty = 'EASY' WHERE id = $1",
      [revision.rows[0]!.id],
    );
    await client.query(
      readFileSync(
        new URL(
          '../../../../packages/db/src/migrations/sql/20261029202409_beta_2_variant_metadata.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const variants: QueryResult<{ diet: string; total_minutes: number }> = await client.query(
      'SELECT diet, total_minutes FROM recipe_variant WHERE recipe_revision_id = $1',
      [revision.rows[0]!.id],
    );
    assert.deepEqual(variants.rows, [
      { diet: 'VEGAN', total_minutes: 90 },
      { diet: 'VEGAN', total_minutes: 90 },
    ]);
    const columns: QueryResult<{ column_name: string }> = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'recipe_revision' AND column_name IN ('diet', 'total_minutes', 'active_minutes', 'kcal', 'servings', 'utensils', 'difficulty')",
    );
    assert.equal(columns.rows.length, 0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
