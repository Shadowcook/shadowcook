import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestUser,
  type TestCategory,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let creator: TestUser;
let editor: TestUser;
let tenant: TestTenant;
let category: TestCategory;
let cookie: string;
let editorCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  creator = await createTestUser(database.pool, { email: 'recipe-creator@example.test' });
  editor = await createTestUser(database.pool, { email: 'later-editor@example.test' });
  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Ursula Müller',
    creator.userId,
  ]);
  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Other editor',
    editor.userId,
  ]);
  tenant = await assignTenantRole(database.pool, creator.principalId, 'recipe-creators', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
    'variant:read',
    'variant:create',
    'variant:update',
    'variant:delete',
  ]);
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, editor.principalId],
  );
  await database.pool.query(
    `INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id)
    SELECT tenant_id, $2, tenant_role_id FROM tenant_membership_role
    WHERE tenant_id = $1 AND principal_id = $3`,
    [tenant.id, editor.principalId, creator.principalId],
  );
  category = await createTestCategory(database.pool, tenant.id, 'Recipes', 'recipes-test');
  const login: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: creator.email, password: creator.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  cookie = String(login.headers['set-cookie']);
  editorCookie = await loginCookie(editor);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('published and shared recipes expose the original creator, preserve read access, and reflect display-name changes', async (): Promise<void> => {
  const publicId: string = await createRecipe('original-creator');
  await publish(publicId);
  const draft: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${recipePath(publicId)}/draft`,
    headers: { cookie },
    payload: {
      title: 'Edited recipe',
      summary: 'Edited description',
      categoryPublicIds: [category.publicId],
    },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  await setDraftCreator(publicId, editor.principalId);
  await publish(publicId);
  const token: string = await shareToken(publicId);
  const urls: string[] = [`/cookbook/recipes/${publicId}`, `/cookbook/share-links/${token}`];
  for (const url of urls) await assertCreator(url, 'Ursula Müller');

  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Ursula Baker',
    creator.userId,
  ]);
  for (const url of urls) await assertCreator(url, 'Ursula Baker');

  const policy: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: recipePath(publicId),
    headers: { cookie },
    payload: {
      slug: 'original-creator',
      visibilityOverride: 'PRIVATE',
      discoverabilityOverride: null,
      isFeatured: true,
    },
  });
  assert.equal(policy.statusCode, 200, policy.body);
  assert.equal((await api.inject({ method: 'GET', url: urls[0]! })).statusCode, 404);
  await assertCreator(urls[1]!, 'Ursula Baker');
});

test('recipes without an original creator return null and service creators use their account name', async (): Promise<void> => {
  const anonymousId: string = await createRecipe('unknown-creator');
  await setDraftCreator(anonymousId, null);
  await publish(anonymousId);
  await assertCreator(`/cookbook/recipes/${anonymousId}`, null);
  await assertCreator(`/cookbook/share-links/${await shareToken(anonymousId)}`, null);

  const principal: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
    "INSERT INTO principal (principal_type) VALUES ('SERVICE_ACCOUNT') RETURNING id",
  );
  const principalId: string = principal.rows[0]!.id;
  await database.pool.query(
    'INSERT INTO service_account (principal_id, tenant_id, name) VALUES ($1, $2, $3)',
    [principalId, tenant.id, 'Recipe assistant'],
  );
  const serviceRecipeId: string = await createRecipe('service-creator');
  await setDraftCreator(serviceRecipeId, principalId);
  await publish(serviceRecipeId);
  await assertCreator(`/cookbook/recipes/${serviceRecipeId}`, 'Recipe assistant');
  await assertCreator(
    `/cookbook/share-links/${await shareToken(serviceRecipeId)}`,
    'Recipe assistant',
  );
});

test('every editor of a shared draft receives one credit only after publication, including archived contributions', async (): Promise<void> => {
  const publicId: string = await createRecipe('shared-draft-credits');
  await publish(publicId);
  const token: string = await shareToken(publicId);
  const creatorName: string = await displayName(creator);
  const thirdEditor: TestUser = await createTestUser(database.pool, {
    email: 'co-editor@example.test',
  });
  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Co-editor',
    thirdEditor.userId,
  ]);
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, thirdEditor.principalId],
  );
  await database.pool.query(
    `INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id)
    SELECT tenant_id, $2, tenant_role_id FROM tenant_membership_role
    WHERE tenant_id = $1 AND principal_id = $3`,
    [tenant.id, thirdEditor.principalId, creator.principalId],
  );
  const thirdCookie: string = await loginCookie(thirdEditor);
  for (const editorSession of [editorCookie, cookie, editorCookie]) {
    const saved: LightMyRequestResponse = await api.inject({
      method: 'PATCH',
      url: `${recipePath(publicId)}/draft`,
      headers: { cookie: editorSession },
      payload: {
        title: 'Collaborative recipe',
        summary: 'Saved by multiple people',
        categoryPublicIds: [category.publicId],
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
  }
  const savedSteps: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(publicId)}/draft/steps`,
    headers: { cookie: thirdCookie },
    payload: {
      steps: [{ instruction: 'Co-edited steps.', ingredients: [{ textOverride: 'Salt' }] }],
    },
  });
  assert.equal(savedSteps.statusCode, 204, savedSteps.body);
  const urls: string[] = [`/cookbook/recipes/${publicId}`, `/cookbook/share-links/${token}`];
  for (const url of urls) await assertContributors(url, [creatorName]);
  await publish(publicId);
  for (const url of urls) await assertContributors(url, [creatorName, 'Co-editor', 'Other editor']);

  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Renamed editor',
    editor.userId,
  ]);
  for (const url of urls)
    await assertContributors(url, [creatorName, 'Co-editor', 'Renamed editor']);
  await database.pool.query('UPDATE user_account SET display_name = $1 WHERE id = $2', [
    'Other editor',
    editor.userId,
  ]);
});

test('discarded drafts and failed variant writes leave no contributor credits', async (): Promise<void> => {
  const publicId: string = await createRecipe('discarded-credits');
  await publish(publicId);
  const creatorName: string = await displayName(creator);
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(publicId)}/draft/variants/10000000-0000-4000-8000-000000000099`,
    headers: { cookie: editorCookie },
    payload: { name: 'Missing', slug: 'missing', isDefault: false, isVisible: true },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const state: QueryResult<{ draft_revision_id: string | null }> = await database.pool.query<{
    draft_revision_id: string | null;
  }>('SELECT draft_revision_id FROM recipe WHERE public_id = $1', [publicId]);
  assert.equal(state.rows[0]!.draft_revision_id, null);
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${recipePath(publicId)}/draft`,
    headers: { cookie: editorCookie },
    payload: {
      title: 'Unpublished changes',
      summary: null,
      categoryPublicIds: [category.publicId],
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const draft: QueryResult<{ draft_revision_id: string }> = await database.pool.query<{
    draft_revision_id: string;
  }>('SELECT draft_revision_id FROM recipe WHERE public_id = $1', [publicId]);
  await assertContributors(`/cookbook/recipes/${publicId}`, [creatorName]);
  const discarded: LightMyRequestResponse = await api.inject({
    method: 'DELETE',
    url: `${recipePath(publicId)}/draft`,
    headers: { cookie },
  });
  assert.equal(discarded.statusCode, 204, discarded.body);
  const remaining: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM recipe_revision_contributor WHERE recipe_revision_id = $1',
    [draft.rows[0]!.draft_revision_id],
  );
  assert.equal(remaining.rows[0]!.count, 0);
  await assertContributors(`/cookbook/recipes/${publicId}`, [creatorName]);
});

test('variant edits record additional editors of an existing draft', async (): Promise<void> => {
  const publicId: string = await createRecipe('variant-credits');
  await publish(publicId);
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${recipePath(publicId)}/draft/variants`,
    headers: { cookie },
    payload: { name: 'Alternative', slug: 'alternative', isDefault: false, isVisible: true },
  });
  assert.equal(created.statusCode, 201, created.body);
  const variantKey: string = created.json<{ variantKey: string }>().variantKey;
  const changed: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(publicId)}/draft/variants/${variantKey}`,
    headers: { cookie: editorCookie },
    payload: { name: 'Edited alternative', slug: 'alternative', isDefault: false, isVisible: true },
  });
  assert.equal(changed.statusCode, 204, changed.body);
  await publish(publicId);
  await assertContributors(`/cookbook/recipes/${publicId}`, [
    await displayName(creator),
    'Other editor',
  ]);
});

test('PDF metadata reflects the cookbook name and published version for normal and shared recipe reads', async (): Promise<void> => {
  const publicId: string = await createRecipe('pdf-metadata');
  await publish(publicId);
  const token: string = await shareToken(publicId);
  const urls: string[] = [`/cookbook/recipes/${publicId}`, `/cookbook/share-links/${token}`];
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${recipePath(publicId)}/draft`,
    headers: { cookie },
    payload: {
      title: 'A later draft',
      summary: 'Not published yet',
      categoryPublicIds: [category.publicId],
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  for (const url of urls) {
    const response: LightMyRequestResponse = await api.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, response.body);
    const detail: { cookbook_name: string; version: number; title: string } = response.json<{
      cookbook_name: string;
      version: number;
      title: string;
    }>();
    assert.equal(detail.cookbook_name, 'Test tenant');
    assert.equal(detail.version, 1);
    assert.equal(detail.title, 'Authored recipe');
  }
  await database.pool.query('UPDATE tenant SET display_name = $1 WHERE id = $2', [
    'Family cookbook',
    tenant.id,
  ]);
  await publish(publicId);
  for (const url of urls) {
    const response: LightMyRequestResponse = await api.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, response.body);
    const detail: { cookbook_name: string; version: number; title: string } = response.json<{
      cookbook_name: string;
      version: number;
      title: string;
    }>();
    assert.equal(detail.cookbook_name, 'Family cookbook');
    assert.equal(detail.version, 2);
    assert.equal(detail.title, 'A later draft');
  }
});

async function loginCookie(actor: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: actor.email, password: actor.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return String(response.headers['set-cookie']);
}

async function displayName(actor: TestUser): Promise<string> {
  const result: QueryResult<{ display_name: string }> = await database.pool.query<{
    display_name: string;
  }>('SELECT display_name FROM user_account WHERE id = $1', [actor.userId]);
  return result.rows[0]!.display_name;
}

async function assertContributors(url: string, expected: string[]): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 200, response.body);
  const contributors: { display_name: string }[] = response.json<{
    contributors: { display_name: string }[];
  }>().contributors;
  assert.deepEqual(
    contributors,
    expected.map((name: string): { display_name: string } => ({ display_name: name })),
  );
  assert.ok(!response.body.includes(creator.email));
  assert.ok(!response.body.includes(editor.email));
  assert.ok(!response.body.includes(creator.principalId));
  assert.ok(!response.body.includes(editor.principalId));
}

function recipePath(publicId: string): string {
  return `/cookbook/tenants/${tenant.slug}/recipes/${publicId}`;
}

test('slug availability covers drafts and published recipes and excludes the current recipe', async (): Promise<void> => {
  const publicId: string = await createRecipe('slug-availability');
  const path: string = `/cookbook/tenants/${tenant.slug}/recipes/slug-availability`;
  for (const published of [false, true]) {
    if (published) await publish(publicId);
    for (const entry of [
      { query: 'slug=unused-slug', available: true },
      { query: 'slug=slug-availability', available: false },
      { query: `slug=slug-availability&excludePublicId=${publicId}`, available: true },
      {
        query: 'slug=slug-availability&excludePublicId=10000000-0000-4000-8000-000000000099',
        available: false,
      },
    ]) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url: `${path}?${entry.query}`,
        headers: { cookie },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { available: entry.available });
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  }
});

test('slug availability validates query input and requires authentication', async (): Promise<void> => {
  const path: string = `/cookbook/tenants/${tenant.slug}/recipes/slug-availability`;
  for (const query of ['', '?slug=', '?slug=Invalid', '?slug=valid&excludePublicId=invalid']) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `${path}${query}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json<{ code: string }>().code, 'INVALID_RECIPE_SLUG_QUERY');
  }
  const anonymous: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}?slug=test`,
  });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
});

test('create-only principals can check slugs and names are scoped to their cookbook', async (): Promise<void> => {
  await createRecipe('other-cookbook-slug');
  const otherTenant: TestTenant = await assignTenantRole(
    database.pool,
    creator.principalId,
    'create-only-slugs',
    ['recipe:create'],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/tenants/${otherTenant.slug}/recipes/slug-availability?slug=other-cookbook-slug`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { available: true });
});

test('creation and metadata saves still report slug conflicts after an advisory availability check', async (): Promise<void> => {
  const existingId: string = await createRecipe('reserved-save-slug');
  const editableId: string = await createRecipe('editable-save-slug');
  const metadata: object = {
    slug: 'reserved-save-slug',
    visibilityOverride: null,
    discoverabilityOverride: null,
    isFeatured: true,
  };
  const responses: LightMyRequestResponse[] = [
    await api.inject({
      method: 'POST',
      url: `/cookbook/tenants/${tenant.slug}/recipes`,
      headers: { cookie },
      payload: { ...metadata, title: 'Duplicate', summary: '', categoryPublicIds: [] },
    }),
    await api.inject({
      method: 'PATCH',
      url: recipePath(editableId),
      headers: { cookie },
      payload: metadata,
    }),
  ];
  for (const response of responses) {
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json<{ code: string }>().code, 'RECIPE_CONFLICT');
  }
  const unchanged: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${recipePath(editableId)}/draft`,
    headers: { cookie },
  });
  assert.equal(unchanged.json<{ slug: string }>().slug, 'editable-save-slug');
  assert.notEqual(existingId, editableId);
});

async function createRecipe(slug: string): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: 'Authored recipe',
      summary: 'Authored description',
      slug,
      categoryPublicIds: [category.publicId],
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const publicId: string = response.json<{ publicId: string }>().publicId;
  const steps: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(publicId)}/draft/steps`,
    headers: { cookie },
    payload: {
      steps: [{ instruction: 'Stir thoroughly.', ingredients: [{ textOverride: 'Salt' }] }],
    },
  });
  assert.equal(steps.statusCode, 204, steps.body);
  return publicId;
}

async function publish(publicId: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${recipePath(publicId)}/publish`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function setDraftCreator(publicId: string, principalId: string | null): Promise<void> {
  await database.pool.query(
    `UPDATE recipe_revision SET created_by_principal_id = $1
    WHERE id = (SELECT draft_revision_id FROM recipe WHERE public_id = $2)`,
    [principalId, publicId],
  );
}

async function shareToken(publicId: string): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${recipePath(publicId)}/share-links`,
    headers: { cookie },
    payload: { name: null, expiresAt: null },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ token: string }>().token;
}

async function assertCreator(url: string, expected: string | null): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    response.json<{ creator_display_name: string | null }>().creator_display_name,
    expected,
  );
  assert.ok(!response.body.includes(creator.email));
  assert.ok(!response.body.includes(creator.principalId));
  assert.ok(!response.body.includes(editor.email));
  assert.ok(!response.body.includes(editor.principalId));
}
