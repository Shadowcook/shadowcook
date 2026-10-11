import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { seedInitialDeployment } from '../../src/initial-deployment-seed.js';
import type { UnitTranslations } from '../../src/unit-translations.js';
import { createTestApi } from '../helpers/api.js';
import { assignTenantRole, createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface UnitResponse {
  publicId: string;
  name: string;
  symbol: string;
  translations: UnitTranslations;
}

interface StoredUnitConversion {
  dimension: string | null;
  base_factor: string | null;
  base_offset: string | null;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administratorCookie: string;
let tenantCookie: string;
const teaspoonId: string = '40000000-0000-4000-8000-000000000212';
const input: {
  name: string;
  symbol: string;
  dimension: string;
  baseFactor: string;
  baseOffset: string;
} = {
  name: 'teaspoon (metric)',
  symbol: 'tsp',
  dimension: 'VOLUME',
  baseFactor: '5',
  baseOffset: '0',
};

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  await seedInitialDeployment(database.pool);
  api = createTestApi(database.pool);
  await api.ready();
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'unit-admin@example.test',
  });
  await database.pool.query(
    `INSERT INTO principal_instance_role (principal_id, instance_role_id)
     SELECT $1, id FROM instance_role WHERE code = 'administrator'`,
    [administrator.principalId],
  );
  const tenantUser: TestUser = await createTestUser(database.pool, {
    email: 'unit-editor@example.test',
  });
  await assignTenantRole(database.pool, tenantUser.principalId, 'unit-test', [
    'unit:read',
    'unit:create',
    'unit:update',
    'unit:delete',
    'recipe:update',
  ]);
  const adminLogin: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: administrator.email, password: administrator.password },
  });
  const tenantLogin: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: tenantUser.email, password: tenantUser.password },
  });
  assert.equal(adminLogin.statusCode, 200);
  assert.equal(tenantLogin.statusCode, 200);
  administratorCookie = String(adminLogin.headers['set-cookie']);
  tenantCookie = String(tenantLogin.headers['set-cookie']);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

async function listTeaspoon(): Promise<UnitResponse> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/units',
    headers: { cookie: administratorCookie },
  });
  assert.equal(response.statusCode, 200);
  const units: UnitResponse[] = response.json<{ units: UnitResponse[] }>().units;
  const unit: UnitResponse | undefined = units.find(
    (candidate: UnitResponse): boolean => candidate.publicId === teaspoonId,
  );
  assert.ok(unit);
  return unit;
}

test('standard unit translations are seeded and edits reach lists and the recipe catalogue', async (): Promise<void> => {
  assert.deepEqual((await listTeaspoon()).translations.de, { name: 'Teelöffel', symbol: 'TL' });
  const translations: UnitTranslations = {
    de: { name: 'Messlöffel', symbol: 'ML' },
    fr: { name: 'cuillère à café', symbol: 'c. à café' },
  };
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/units/${teaspoonId}`,
    headers: { cookie: administratorCookie },
    payload: { ...input, translations },
  });
  assert.equal(saved.statusCode, 204);
  assert.deepEqual((await listTeaspoon()).translations, translations);
  const catalogue: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook/tenants/unit-test/editor-catalogue',
    headers: { cookie: tenantCookie },
  });
  assert.equal(catalogue.statusCode, 200);
  assert.deepEqual(
    catalogue
      .json<{ units: UnitResponse[] }>()
      .units.find((unit: UnitResponse): boolean => unit.publicId === teaspoonId)?.translations,
    translations,
  );
});

test('omitting translations preserves them and an empty map removes them', async (): Promise<void> => {
  const beforeUnit: UnitResponse = await listTeaspoon();
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/units/${teaspoonId}`,
    headers: { cookie: administratorCookie },
    payload: { ...input, name: 'renamed teaspoon' },
  });
  assert.equal(saved.statusCode, 204);
  assert.deepEqual((await listTeaspoon()).translations, beforeUnit.translations);
  assert.equal((await listTeaspoon()).name, 'renamed teaspoon');
  const cleared: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/units/${teaspoonId}`,
    headers: { cookie: administratorCookie },
    payload: { ...input, translations: {} },
  });
  assert.equal(cleared.statusCode, 204);
  assert.deepEqual((await listTeaspoon()).translations, {});
});

test('invalid versions and conflicting default names leave the unit unchanged', async (): Promise<void> => {
  const beforeUnit: UnitResponse = await listTeaspoon();
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/units/${teaspoonId}`,
    headers: { cookie: administratorCookie },
    payload: {
      ...input,
      name: 'must not be stored',
      translations: { de: { name: '', symbol: 'X' } },
    },
  });
  assert.equal(invalid.statusCode, 400);
  const conflict: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/units/${teaspoonId}`,
    headers: { cookie: administratorCookie },
    payload: {
      ...input,
      name: 'tablespoon (metric)',
      translations: { de: { name: 'must not be stored', symbol: 'X' } },
    },
  });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(await listTeaspoon(), beforeUnit);
});

test('tenant unit creation, editing, and deletion handle all language versions', async (): Promise<void> => {
  const endpoint: string = '/cookbook/tenants/unit-test/units';
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: endpoint,
    headers: { cookie: tenantCookie },
    payload: {
      name: 'scoop',
      symbol: 'sc',
      equivalenceAmount: null,
      referenceUnitPublicId: null,
      translations: { de: { name: 'Schaufel', symbol: 'Sch.' } },
    },
  });
  assert.equal(created.statusCode, 201);
  const unit: UnitResponse = created.json<UnitResponse>();
  assert.deepEqual(unit.translations.de, { name: 'Schaufel', symbol: 'Sch.' });
  const edited: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${endpoint}/${unit.publicId}`,
    headers: { cookie: tenantCookie },
    payload: {
      name: 'scoop',
      symbol: 'sc',
      translations: { de: { name: 'Portionierer', symbol: 'Port.' } },
    },
  });
  assert.equal(edited.statusCode, 204);
  const list: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: endpoint,
    headers: { cookie: tenantCookie },
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json<{ units: UnitResponse[] }>().units[0]?.translations.de, {
    name: 'Portionierer',
    symbol: 'Port.',
  });
  const forbidden: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${endpoint}/${teaspoonId}`,
    headers: { cookie: tenantCookie },
    payload: { name: 'scoop', symbol: 'sc', translations: {} },
  });
  assert.equal(forbidden.statusCode, 404);
  const deleted: LightMyRequestResponse = await api.inject({
    method: 'DELETE',
    url: `${endpoint}/${unit.publicId}`,
    headers: { cookie: tenantCookie },
  });
  assert.equal(deleted.statusCode, 204);
  const remaining: QueryResult = await database.pool.query(
    'SELECT 1 FROM unit_translation INNER JOIN unit ON unit.id = unit_translation.unit_id WHERE unit.public_id = $1',
    [unit.publicId],
  );
  assert.equal(remaining.rowCount, 0);
});

test('used tenant units allow default names, symbols, and translations to change without conversion fields', async (): Promise<void> => {
  for (const convertible of [false, true]) {
    const unit: UnitResponse = await createUsedTenantUnit(convertible);
    const beforeConversion: StoredUnitConversion = await storedConversion(unit.publicId);
    const translations: UnitTranslations = { de: { name: 'Spritzer', symbol: 'Spr.' } };
    const edited: LightMyRequestResponse = await api.inject({
      method: 'PATCH',
      url: `/cookbook/tenants/unit-test/units/${unit.publicId}`,
      headers: { cookie: tenantCookie },
      payload: { name: `squeeze ${convertible}`, symbol: `sq-${convertible}`, translations },
    });
    assert.equal(edited.statusCode, 204, edited.body);
    assert.deepEqual(await storedConversion(unit.publicId), beforeConversion);
    const listed: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/cookbook/tenants/unit-test/units',
      headers: { cookie: tenantCookie },
    });
    assert.equal(listed.statusCode, 200);
    const updated: UnitResponse | undefined = listed
      .json<{ units: UnitResponse[] }>()
      .units.find((candidate: UnitResponse): boolean => candidate.publicId === unit.publicId);
    assert.ok(updated);
    assert.equal(updated.name, `squeeze ${convertible}`);
    assert.equal(updated.symbol, `sq-${convertible}`);
    assert.deepEqual(updated.translations, translations);
  }
});

test('used tenant units accept numerically identical conversion values with different decimal scales', async (): Promise<void> => {
  const unit: UnitResponse = await createUsedTenantUnit(true);
  const beforeConversion: StoredUnitConversion = await storedConversion(unit.publicId);
  const edited: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/cookbook/tenants/unit-test/units/${unit.publicId}`,
    headers: { cookie: tenantCookie },
    payload: {
      name: unit.name,
      symbol: unit.symbol,
      equivalenceAmount: '2.000000000000',
      referenceUnitPublicId: teaspoonId,
    },
  });
  assert.equal(edited.statusCode, 204, edited.body);
  assert.deepEqual(await storedConversion(unit.publicId), beforeConversion);
});

test('used tenant units reject conversion changes and keep names and translations unchanged', async (): Promise<void> => {
  for (const convertible of [false, true]) {
    const unit: UnitResponse = await createUsedTenantUnit(convertible);
    const beforeConversion: StoredUnitConversion = await storedConversion(unit.publicId);
    const conversions: {
      equivalenceAmount: string | null;
      referenceUnitPublicId: string | null;
    }[] = [
      { equivalenceAmount: '3', referenceUnitPublicId: teaspoonId },
      { equivalenceAmount: '2.000000000001', referenceUnitPublicId: teaspoonId },
      ...(convertible ? [{ equivalenceAmount: null, referenceUnitPublicId: null }] : []),
    ];
    for (const conversion of conversions) {
      const rejected: LightMyRequestResponse = await api.inject({
        method: 'PATCH',
        url: `/cookbook/tenants/unit-test/units/${unit.publicId}`,
        headers: { cookie: tenantCookie },
        payload: {
          name: `rejected ${unit.publicId}`,
          symbol: `rejected-${unit.publicId}`,
          translations: { de: { name: 'Rejected translation', symbol: 'X' } },
          ...conversion,
        },
      });
      assert.equal(rejected.statusCode, 409, rejected.body);
      assert.equal(rejected.json<{ code: string }>().code, 'UNIT_IN_USE');
      assert.deepEqual(await storedConversion(unit.publicId), beforeConversion);
      const stored: QueryResult<{ name: string; symbol: string }> = await database.pool.query<{
        name: string;
        symbol: string;
      }>('SELECT name, symbol FROM unit WHERE public_id = $1', [unit.publicId]);
      assert.deepEqual(stored.rows, [{ name: unit.name, symbol: unit.symbol }]);
      const translations: QueryResult = await database.pool.query(
        'SELECT 1 FROM unit_translation JOIN unit ON unit.id = unit_translation.unit_id WHERE unit.public_id = $1',
        [unit.publicId],
      );
      assert.equal(translations.rowCount, 0);
    }
  }
});

async function createUsedTenantUnit(convertible: boolean): Promise<UnitResponse> {
  const sequence: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM unit WHERE owner_tenant_id IS NOT NULL',
  );
  const name: string = `used scoop ${sequence.rows[0]!.count}`;
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/cookbook/tenants/unit-test/units',
    headers: { cookie: tenantCookie },
    payload: {
      name,
      symbol: name,
      equivalenceAmount: convertible ? '2' : null,
      referenceUnitPublicId: convertible ? teaspoonId : null,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const unit: UnitResponse = created.json<UnitResponse>();
  await database.pool.query(
    `WITH created_recipe AS (
       INSERT INTO recipe (tenant_id, lineage_public_id, slug)
       SELECT id, gen_random_uuid(), $2 FROM tenant WHERE slug = 'unit-test'
       RETURNING id
     ), created_revision AS (
       INSERT INTO recipe_revision (recipe_id, revision_no, status, title)
       SELECT id, 1, 'DRAFT', 'Unit usage fixture' FROM created_recipe
       RETURNING id
     ), created_step AS (
       INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction)
       SELECT id, gen_random_uuid(), 0, 'Add the ingredient.' FROM created_revision
       RETURNING id
     )
     INSERT INTO ingredient_usage (recipe_step_id, usage_key, text_override, unit_id, amount, sort_order)
     SELECT created_step.id, gen_random_uuid(), 'Test ingredient', unit.id, 1, 0
     FROM created_step CROSS JOIN unit WHERE unit.public_id = $1`,
    [unit.publicId, `unit-${unit.publicId}`],
  );
  return unit;
}

async function storedConversion(publicId: string): Promise<StoredUnitConversion> {
  const result: QueryResult<StoredUnitConversion> = await database.pool.query<StoredUnitConversion>(
    'SELECT dimension, base_factor::text, base_offset::text FROM unit WHERE public_id = $1',
    [publicId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}
