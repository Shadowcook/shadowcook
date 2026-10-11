import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

interface EditableRecipe {
  publicId: string;
  title: string;
  slug: string;
  isDraft: boolean;
  hasPublishedRevision: boolean;
  publishedVersion: number | null;
  isFeatured: boolean;
}

interface RecipeState {
  id: string;
  draft_revision_id: string | null;
  published_revision_id: string | null;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let otherTenant: TestTenant;
let category: TestCategory;
let editorCookie: string;
let readerCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const editor: TestUser = await createTestUser(database.pool, {
    email: 'draft-editor@example.test',
  });
  tenant = await assignTenantRole(database.pool, editor.principalId, 'draft-tests', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:revision:read',
  ]);
  otherTenant = await assignTenantRole(database.pool, editor.principalId, 'other-draft-tests', [
    'recipe:update',
  ]);
  category = await createTestCategory(database.pool, tenant.id, 'Recipes', 'test-recipes');
  const reader: TestUser = await createTestUser(database.pool, {
    email: 'draft-reader@example.test',
  });
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, reader.principalId],
  );
  editorCookie = await loginCookie(editor);
  readerCookie = await loginCookie(reader);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('discarding a new recipe removes its draft and dependent content and frees its slug', async (): Promise<void> => {
  const recipe: EditableRecipe = await createRecipe('new-draft');
  await saveSteps(recipe.publicId, 'Unpublished instruction');
  const state: RecipeState = await recipeState(recipe.publicId);

  const response: LightMyRequestResponse = await discard(recipe.publicId);
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  const remaining: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
    'SELECT id FROM recipe WHERE public_id = $1',
    [recipe.publicId],
  );
  assert.equal(remaining.rowCount, 0);
  await assertDraftRemoved(state);
  assert.equal((await discard(recipe.publicId)).statusCode, 404);
  const replacement: EditableRecipe = await createRecipe('new-draft');
  assert.notEqual(replacement.publicId, recipe.publicId);
});

test('discard retains published content, archived history, metadata and subsequent publishing', async (): Promise<void> => {
  const recipe: EditableRecipe = await createRecipe('published-draft');
  await saveSteps(recipe.publicId, 'Published instruction');
  await publish(recipe.publicId);
  await saveDraft(recipe.publicId, 'Second published title');
  await publish(recipe.publicId);
  const historyBefore: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${recipePath(recipe.publicId)}/revisions`,
    headers: { cookie: editorCookie },
  });
  assert.equal(historyBefore.statusCode, 200);
  assert.equal(historyBefore.json<{ revisions: unknown[] }>().revisions.length, 2);
  await saveDraft(recipe.publicId, 'Discard this title');
  await saveSteps(recipe.publicId, 'Discard this instruction');
  const metadata: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: recipePath(recipe.publicId),
    headers: { cookie: editorCookie },
    payload: {
      slug: 'retained-settings',
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: false,
    },
  });
  assert.equal(metadata.statusCode, 200);
  const state: RecipeState = await recipeState(recipe.publicId);
  assert.equal((await discard(recipe.publicId)).statusCode, 204);
  await assertDraftRemoved(state);

  const loadedResponse: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${recipePath(recipe.publicId)}/draft`,
    headers: { cookie: editorCookie },
  });
  assert.equal(loadedResponse.statusCode, 200);
  const loaded: EditableRecipe = loadedResponse.json<EditableRecipe>();
  assert.equal(loaded.title, 'Second published title');
  assert.equal(loaded.isDraft, false);
  assert.equal(loaded.hasPublishedRevision, true);
  assert.equal(loaded.publishedVersion, 2);
  assert.equal(loaded.slug, 'retained-settings');
  assert.equal(loaded.isFeatured, false);
  assert.equal(
    (await recipeState(recipe.publicId)).published_revision_id,
    state.published_revision_id,
  );
  const stepsResponse: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${recipePath(recipe.publicId)}/draft/steps`,
    headers: { cookie: editorCookie },
  });
  assert.equal(
    stepsResponse.json<{ steps: { instruction: string }[] }>().steps[0]?.instruction,
    'Published instruction',
  );
  const historyAfter: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${recipePath(recipe.publicId)}/revisions`,
    headers: { cookie: editorCookie },
  });
  assert.equal(historyAfter.statusCode, 200);
  assert.equal(historyAfter.body, historyBefore.body);
  assert.equal((await discard(recipe.publicId)).statusCode, 404);
  await saveDraft(recipe.publicId, 'Third published title');
  const published: EditableRecipe = await publish(recipe.publicId);
  assert.equal(published.publishedVersion, 3);
});

test('discard requires authentication and update permission and respects tenant boundaries', async (): Promise<void> => {
  const recipe: EditableRecipe = await createRecipe('protected-draft');
  const state: RecipeState = await recipeState(recipe.publicId);
  const anonymous: LightMyRequestResponse = await api.inject({
    method: 'DELETE',
    url: `${recipePath(recipe.publicId)}/draft`,
  });
  assert.equal(anonymous.statusCode, 401);
  assert.equal((await discard(recipe.publicId, tenant.slug, readerCookie)).statusCode, 403);
  assert.equal((await discard(recipe.publicId, otherTenant.slug)).statusCode, 404);
  assert.deepEqual(await recipeState(recipe.publicId), state);
});

test('absent drafts and malformed recipe identifiers return the documented not-found error', async (): Promise<void> => {
  for (const publicId of [randomUUID(), 'invalid-uuid']) {
    const response: LightMyRequestResponse = await discard(publicId);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      code: 'RECIPE_DRAFT_NOT_FOUND',
      error: 'The recipe draft was not found.',
    });
  }
});

test('concurrent discard requests delete an active draft only once', async (): Promise<void> => {
  const recipe: EditableRecipe = await createRecipe('concurrent-draft');
  const responses: LightMyRequestResponse[] = await Promise.all([
    discard(recipe.publicId),
    discard(recipe.publicId),
  ]);
  const statuses: number[] = responses.map(
    (response: LightMyRequestResponse): number => response.statusCode,
  );
  assert.deepEqual(statuses.sort(), [204, 404]);
});

function recipePath(publicId: string, tenantSlug: string = tenant.slug): string {
  return `/cookbook/tenants/${tenantSlug}/recipes/${publicId}`;
}

function discard(
  publicId: string,
  tenantSlug: string = tenant.slug,
  cookie: string = editorCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'DELETE',
    url: `${recipePath(publicId, tenantSlug)}/draft`,
    headers: { cookie },
  });
}

async function createRecipe(slug: string): Promise<EditableRecipe> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie: editorCookie },
    payload: {
      title: 'Original recipe title',
      summary: 'Authored summary',
      slug,
      categoryPublicIds: [category.publicId],
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<EditableRecipe>();
}

async function saveDraft(publicId: string, title: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${recipePath(publicId)}/draft`,
    headers: { cookie: editorCookie },
    payload: { title, summary: 'Changed summary', categoryPublicIds: [category.publicId] },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function saveSteps(publicId: string, instruction: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(publicId)}/draft/steps`,
    headers: { cookie: editorCookie },
    payload: { steps: [{ instruction, ingredients: [{ textOverride: 'Salt' }] }] },
  });
  assert.equal(response.statusCode, 204, response.body);
}

async function publish(publicId: string): Promise<EditableRecipe> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${recipePath(publicId)}/publish`,
    headers: { cookie: editorCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<EditableRecipe>();
}

async function recipeState(publicId: string): Promise<RecipeState> {
  const result: QueryResult<RecipeState> = await database.pool.query<RecipeState>(
    'SELECT id, draft_revision_id, published_revision_id FROM recipe WHERE public_id = $1',
    [publicId],
  );
  assert.ok(result.rows[0]);
  return result.rows[0];
}

async function assertDraftRemoved(state: RecipeState): Promise<void> {
  assert.notEqual(state.draft_revision_id, null);
  for (const table of [
    'recipe_revision',
    'recipe_step',
    'recipe_variant',
    'recipe_revision_category',
  ]) {
    const column: string = table === 'recipe_revision' ? 'id' : 'recipe_revision_id';
    const result: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ${table} WHERE ${column} = $1`,
      [state.draft_revision_id],
    );
    assert.equal(result.rows[0]?.count, 0, table);
  }
  const orphans: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ingredient_usage AS usage
     LEFT JOIN recipe_step AS step ON step.id = usage.recipe_step_id WHERE step.id IS NULL`,
  );
  assert.equal(orphans.rows[0]?.count, 0);
}

async function loginCookie(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200);
  const cookie: string | string[] | undefined = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return cookie as string;
}
