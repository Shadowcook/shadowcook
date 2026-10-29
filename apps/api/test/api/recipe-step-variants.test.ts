import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestUser,
  type TestTenant,
  type TestUser,
  type TestCategory,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface Variant {
  variantKey: string;
  isDefault: boolean;
  overrides: Array<{ stepId: string; state: 'INCLUDE' }>;
}
interface Step {
  id: string;
  stepKey: string;
  instruction: string;
  ingredients: unknown[];
}
let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let category: TestCategory;
let cookie: string;
let recipeOnlyCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const user: TestUser = await createTestUser(database.pool, {
    email: 'step-variants@example.test',
  });
  tenant = await assignTenantRole(database.pool, user.principalId, 'step-variants', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
    'variant:read',
    'variant:create',
    'variant:update',
  ]);
  category = await createTestCategory(database.pool, tenant.id, 'Steps', 'steps');
  cookie = await login(user);
  const limited: TestUser = await createTestUser(database.pool, {
    email: 'steps-only@example.test',
  });
  const role = await database.pool.query<{ id: string }>(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Steps only') RETURNING id",
    [tenant.id],
  );
  await database.pool.query(
    "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) VALUES ($1, 'recipe:update')",
    [role.rows[0]!.id],
  );
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, limited.principalId],
  );
  await database.pool.query(
    'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
    [tenant.id, limited.principalId, role.rows[0]!.id],
  );
  recipeOnlyCookie = await login(limited);
});
after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});
async function login(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return String(response.headers['set-cookie']);
}
async function create(): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: 'Variants',
      slug: `variants-${randomUUID()}`,
      summary: '',
      categoryPublicIds: [category.publicId],
      visibilityOverride: 'PUBLIC',
      discoverabilityOverride: 'DISCOVERABLE',
      isFeatured: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `/cookbook/tenants/${tenant.slug}/recipes/${response.json<{ publicId: string }>().publicId}`;
}
async function variants(path: string): Promise<Variant[]> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/draft/variants`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ variants: Variant[] }>().variants;
}
async function steps(path: string): Promise<Step[]> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/draft/steps`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ steps: Step[] }>().steps;
}
async function save(
  path: string,
  input: object[],
  expected: number = 204,
  credential: string = cookie,
): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path}/draft/steps`,
    headers: { cookie: credential },
    payload: { steps: input },
  });
  assert.equal(response.statusCode, expected, response.body);
}

test('new steps save their selected memberships atomically and preserve them on subsequent saves and draft creation', async (): Promise<void> => {
  const path: string = await create();
  const creation: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path}/draft/variants`,
    headers: { cookie },
    payload: { name: 'Alternate', slug: 'alternate', isDefault: false, isVisible: true },
  });
  assert.equal(creation.statusCode, 201, creation.body);
  const initial: Variant[] = await variants(path);
  const alternate: Variant = initial.find((variant: Variant): boolean => !variant.isDefault)!;
  await save(path, [
    {
      id: randomUUID(),
      instruction: 'Alternate step',
      ingredients: [],
      includedVariantKeys: [alternate.variantKey],
    },
    { instruction: 'Default step', ingredients: [] },
    { instruction: 'Unassigned step', ingredients: [], includedVariantKeys: [] },
  ]);
  let saved: Step[] = await steps(path);
  const originalKeys: string[] = saved.map((step: Step): string => step.stepKey);
  let memberships: Variant[] = await variants(path);
  assert.deepEqual(
    memberships
      .find((variant: Variant): boolean => variant.isDefault)!
      .overrides.map((entry): string => entry.stepId),
    [saved[1]!.id],
  );
  assert.deepEqual(
    memberships
      .find((variant: Variant): boolean => !variant.isDefault)!
      .overrides.map((entry): string => entry.stepId),
    [saved[0]!.id],
  );
  await save(path, [saved[2]!, saved[0]!, saved[1]!]);
  saved = await steps(path);
  assert.deepEqual(
    saved.map((step: Step): string => step.stepKey),
    [originalKeys[2], originalKeys[0], originalKeys[1]],
  );
  memberships = await variants(path);
  assert.equal(
    memberships.find((variant: Variant): boolean => !variant.isDefault)!.overrides[0]!.stepId,
    saved[1]!.id,
  );
  const publish: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path}/publish`,
    headers: { cookie },
  });
  assert.equal(publish.statusCode, 200, publish.body);
  await save(path, saved);
  saved = await steps(path);
  assert.deepEqual(
    saved.map((step: Step): string => step.stepKey),
    [originalKeys[2], originalKeys[0], originalKeys[1]],
  );
  memberships = await variants(path);
  assert.equal(
    memberships.find((variant: Variant): boolean => !variant.isDefault)!.overrides[0]!.stepId,
    saved[1]!.id,
  );
  assert.equal(
    memberships.find((variant: Variant): boolean => variant.isDefault)!.overrides[0]!.stepId,
    saved[2]!.id,
  );
});

test('invalid memberships and duplicate step IDs roll back step replacement; explicit membership requires variant permission', async (): Promise<void> => {
  const path: string = await create();
  await save(path, [{ instruction: 'Keep me', ingredients: [] }]);
  const original: Step[] = await steps(path);
  const defaultVariant: Variant = (await variants(path))[0]!;
  const foreignPath: string = await create();
  const foreignVariant: Variant = (await variants(foreignPath))[0]!;
  for (const keys of [
    [randomUUID()],
    [foreignVariant.variantKey],
    [defaultVariant.variantKey, defaultVariant.variantKey],
  ]) {
    await save(path, [{ ...original[0], instruction: 'Changed', includedVariantKeys: keys }], 400);
    assert.deepEqual(await steps(path), original);
  }
  await save(path, [original[0]!, original[0]!], 400);
  await save(path, [{ ...original[0], includedVariantKeys: [] }], 403, recipeOnlyCookie);
  assert.deepEqual(await steps(path), original);
  await save(path, original, 204, recipeOnlyCookie);
});

test('new variants copy exactly the current default memberships in drafts and published recipes', async (): Promise<void> => {
  for (const published of [false, true]) {
    for (const isDefault of [false, true]) {
      const path: string = await create();
      const defaultVariant: Variant = (await variants(path))[0]!;
      const otherCreation: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: `${path}/draft/variants`,
        headers: { cookie },
        payload: { name: 'Other variant', slug: 'other', isDefault: false, isVisible: true },
      });
      assert.equal(otherCreation.statusCode, 201, otherCreation.body);
      const otherKey: string = otherCreation.json<{ variantKey: string }>().variantKey;
      await save(path, [
        { instruction: 'Shared preparation', ingredients: [] },
        { instruction: 'Default finishing', ingredients: [] },
        { instruction: 'Other variant only', ingredients: [], includedVariantKeys: [otherKey] },
        { instruction: 'Unassigned alternative', ingredients: [], includedVariantKeys: [] },
      ]);
      const originalSteps: Step[] = await steps(path);
      if (published) {
        const publication: LightMyRequestResponse = await api.inject({
          method: 'POST',
          url: `${path}/publish`,
          headers: { cookie },
        });
        assert.equal(publication.statusCode, 200, publication.body);
      }
      const creation: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: `${path}/draft/variants`,
        headers: { cookie },
        payload: { name: 'New variant', slug: 'new-variant', isDefault, isVisible: true },
      });
      assert.equal(creation.statusCode, 201, creation.body);
      const newKey: string = creation.json<{ variantKey: string }>().variantKey;
      const savedSteps: Step[] = await steps(path);
      const memberships: Variant[] = await variants(path);
      const created: Variant = memberships.find(
        (item: Variant): boolean => item.variantKey === newKey,
      )!;
      const expectedIds: string[] = savedSteps
        .slice(0, 2)
        .map((step: Step): string => step.id)
        .sort();
      assert.deepEqual(created.overrides.map((entry): string => entry.stepId).sort(), expectedIds);
      assert.equal(created.isDefault, isDefault);
      assert.deepEqual(
        memberships
          .find((item: Variant): boolean => item.variantKey === defaultVariant.variantKey)!
          .overrides.map((entry): string => entry.stepId)
          .sort(),
        expectedIds,
      );
      assert.deepEqual(
        savedSteps.map((step: Step): string => step.stepKey),
        originalSteps.map((step: Step): string => step.stepKey),
      );
    }
  }
});
