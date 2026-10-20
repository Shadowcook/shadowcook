import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test, type TestContext } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import { createPublicApiClient } from '../helpers/public-api-client.js';
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

type ScopeType = 'TENANT' | 'CATEGORY' | 'RECIPE';
type EndpointName = 'overview' | 'recipe' | 'revisions' | 'revision' | 'draft';

interface Manifest {
  baseUrl: string;
  accessToken: string;
  expiresAt: string;
  scope: { type: ScopeType; publicId: string };
  endpoints: Record<EndpointName, { method: 'GET'; path: string; url: string }>;
  authentication: {
    type: string;
    header: string;
    queryParameter: string;
    queryTemplate: string;
  };
  requestInstructions: string;
  restrictions: string[];
}

interface Overview {
  categories: { public_id: string }[];
  recipes: { public_id: string; title: string }[];
}

interface ScopeCase {
  type: ScopeType;
  id: string;
  allowed: string[];
  denied: string[];
}

interface RevisionSummary {
  public_id: string;
  status: string;
}

const publicApiOrigin: string = 'http://test-web.invalid/api';
let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let foreignTenant: TestTenant;
let parent: TestCategory;
let child: TestCategory;
let sibling: TestCategory;
let cookie: string;
let recipeId: string;
let childRecipeId: string;
let siblingRecipeId: string;
let foreignRecipeId: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool, [], publicApiOrigin);
  await api.ready();
  const user: TestUser = await createTestUser(database.pool, { email: 'ai-share@example.test' });
  tenant = await assignTenantRole(database.pool, user.principalId, 'ai-sharing', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
  ]);
  foreignTenant = await assignTenantRole(database.pool, user.principalId, 'ai-other', [
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
  ]);
  parent = await createTestCategory(database.pool, tenant.id, 'Parent', 'parent');
  await database.pool.query('UPDATE category SET sort_order = 1 WHERE public_id = $1', [
    parent.publicId,
  ]);
  child = await createTestCategory(database.pool, tenant.id, 'Child', 'child');
  await database.pool.query(
    'UPDATE category SET parent_id = (SELECT id FROM category WHERE public_id = $1) WHERE public_id = $2',
    [parent.publicId, child.publicId],
  );
  sibling = await createTestCategory(database.pool, tenant.id, 'Sibling', 'sibling');
  const foreignCategory: TestCategory = await createTestCategory(
    database.pool,
    foreignTenant.id,
    'Foreign',
    'foreign',
  );
  const login: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  cookie = String(login.headers['set-cookie']);
  recipeId = await createRecipe(tenant, parent, 'shared-recipe');
  childRecipeId = await createRecipe(tenant, child, 'child-recipe');
  siblingRecipeId = await createRecipe(tenant, sibling, 'sibling-recipe');
  foreignRecipeId = await createRecipe(foreignTenant, foreignCategory, 'foreign-recipe');
  await saveDraft(recipeId, 'Second published version');
  await publish(tenant, recipeId);
  await saveDraft(recipeId, 'Current unpublished draft');
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('the public share URL and manifest credentials work together through the web proxy', async (context: TestContext): Promise<void> => {
  const request: (request: Request) => Promise<Response> = await createPublicApiClient(
    context,
    api,
  );
  const created: Response = await request(
    new Request(`${publicApiOrigin}/cookbook/tenants/${tenant.slug}/ai-contexts`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scopeType: 'RECIPE', scopePublicId: recipeId, durationHours: 4 }),
    }),
  );
  assert.equal(created.status, 201);
  const shared: { url: string } = await created.json();
  const bootstrap: Response = await request(new Request(shared.url));
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
  assert.equal(bootstrap.headers.get('referrer-policy'), 'no-referrer');
  const manifest: Manifest = await bootstrap.json();
  const revision: QueryResult<{ public_id: string }> = await database.pool.query(
    'SELECT revision.public_id FROM recipe JOIN recipe_revision revision ON revision.id = recipe.published_revision_id WHERE recipe.public_id = $1',
    [recipeId],
  );
  for (const name of ['overview', 'recipe', 'revisions', 'revision', 'draft'] as const) {
    const template: string = manifest.endpoints[name].url ?? manifest.endpoints[name].path;
    const url: string = new URL(
      template
        .replace('{publicId}', recipeId)
        .replace('{revisionPublicId}', revision.rows[0]!.public_id),
      `${manifest.baseUrl}/`,
    ).href;
    for (const transport of ['header', 'query'] as const) {
      const target: URL = new URL(url);
      const headers: Headers = new Headers();
      if (transport === 'header') {
        headers.set(
          'authorization',
          manifest.authentication.header
            .replace('Authorization: ', '')
            .replace('{accessToken}', manifest.accessToken),
        );
      } else {
        target.searchParams.set('existing', 'preserved');
        target.searchParams.set(manifest.authentication.queryParameter, manifest.accessToken);
      }
      const response: Response = await request(
        new Request(target, { method: manifest.endpoints[name].method, headers }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(url.startsWith(`${publicApiOrigin}/`), url);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    }
  }
  assert.equal(manifest.authentication.queryTemplate, 'access_token={accessToken}');
  assert.match(manifest.requestInstructions, /cannot set Authorization headers/);
  assert.equal((await request(new Request(shared.url))).status, 404);
});

test('the issued bearer credentials read overview, published recipe, history, revision and draft', async (): Promise<void> => {
  const manifest: Manifest = await exchange(await createGrant('RECIPE', recipeId));
  assert.deepEqual(manifest.scope, { type: 'RECIPE', publicId: recipeId });
  assert.equal(manifest.authentication.header, 'Authorization: Bearer {accessToken}');
  const overview: LightMyRequestResponse = await reader(manifest, 'overview');
  assert.equal(overview.statusCode, 200, overview.body);
  assert.deepEqual(
    overview
      .json<Overview>()
      .recipes.map((recipe: Overview['recipes'][number]): string => recipe.public_id),
    [recipeId],
  );
  const recipe: LightMyRequestResponse = await reader(manifest, 'recipe', recipeId);
  assert.equal(recipe.statusCode, 200, recipe.body);
  assert.equal(recipe.json<{ title: string }>().title, 'Second published version');
  assert.equal(
    recipe.json<{ steps: { instruction: string }[] }>().steps[0]!.instruction,
    'Gründlich umrühren.',
  );
  const ingredients: { ingredient_name: string; amount: string; note: string }[] = recipe.json<{
    steps: { ingredients: { ingredient_name: string; amount: string; note: string }[] }[];
  }>().steps[0]!.ingredients;
  assert.equal(ingredients[0]!.ingredient_name, 'Salz');
  assert.equal(Number(ingredients[0]!.amount), 2);
  assert.equal(ingredients[0]!.note, 'Nach Geschmack');
  const revisions: LightMyRequestResponse = await reader(manifest, 'revisions', recipeId);
  assert.equal(revisions.statusCode, 200, revisions.body);
  const history: RevisionSummary[] = revisions.json<{ revisions: RevisionSummary[] }>().revisions;
  assert.deepEqual(
    history.map((revision: RevisionSummary): string => revision.status),
    ['PUBLISHED', 'ARCHIVED'],
  );
  for (const revision of history) {
    const response: LightMyRequestResponse = await reader(
      manifest,
      'revision',
      recipeId,
      revision.public_id,
    );
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json<{ public_id: string }>().public_id, revision.public_id);
  }
  const draft: LightMyRequestResponse = await reader(manifest, 'draft', recipeId);
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(draft.json<{ title: string }>().title, 'Current unpublished draft');
  assert.ok(!manifest.restrictions.includes('no draft access'));
  const stored: QueryResult<{ access_token_hash: Buffer; last_used_at: Date }> =
    await database.pool.query(
      'SELECT access_token_hash, last_used_at FROM ai_context_grant WHERE access_token_hash = $1',
      [tokenHash(manifest.accessToken)],
    );
  assert.deepEqual(stored.rows[0]!.access_token_hash, tokenHash(manifest.accessToken));
  assert.ok(stored.rows[0]!.last_used_at instanceof Date);
});

test('recipe, category subtree and tenant grants enforce scope on every reader endpoint', async (): Promise<void> => {
  const scopes: ScopeCase[] = [
    {
      type: 'RECIPE',
      id: recipeId,
      allowed: [recipeId],
      denied: [childRecipeId, siblingRecipeId, foreignRecipeId],
    },
    {
      type: 'CATEGORY',
      id: parent.publicId,
      allowed: [recipeId, childRecipeId],
      denied: [siblingRecipeId, foreignRecipeId],
    },
    {
      type: 'TENANT',
      id: tenant.publicId,
      allowed: [recipeId, childRecipeId, siblingRecipeId],
      denied: [foreignRecipeId],
    },
  ];
  for (const entry of scopes.flatMap(
    (scope: ScopeCase): { scope: ScopeCase; transport: 'header' | 'query' }[] => [
      { scope, transport: 'header' },
      { scope, transport: 'query' },
    ],
  )) {
    const scope: ScopeCase = entry.scope;
    const manifest: Manifest = await exchange(await createGrant(scope.type, scope.id));
    const overview: LightMyRequestResponse = await reader(
      manifest,
      'overview',
      recipeId,
      '',
      entry.transport,
    );
    assert.equal(overview.statusCode, 200, overview.body);
    assert.deepEqual(
      overview
        .json<Overview>()
        .recipes.map((recipe: Overview['recipes'][number]): string => recipe.public_id)
        .sort(),
      [...scope.allowed].sort(),
    );
    if (scope.type === 'CATEGORY') {
      assert.deepEqual(
        overview
          .json<Overview>()
          .categories.map((category: Overview['categories'][number]): string => category.public_id)
          .sort(),
        [parent.publicId, child.publicId].sort(),
      );
    }
    for (const publicId of scope.allowed) {
      assert.equal(
        (await reader(manifest, 'recipe', publicId, '', entry.transport)).statusCode,
        200,
      );
    }
    for (const publicId of scope.denied) {
      for (const endpoint of ['recipe', 'revisions', 'revision', 'draft'] as const) {
        const response: LightMyRequestResponse = await reader(
          manifest,
          endpoint,
          publicId,
          randomUUID(),
          entry.transport,
        );
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json<{ code: string }>().code, 'RECIPE_NOT_FOUND');
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.headers['referrer-policy'], 'no-referrer');
      }
    }
  }
});

test('grant creation requires sharing permission, rejects foreign scopes, and supports all configured lifetimes', async (): Promise<void> => {
  const viewer: TestUser = await createTestUser(database.pool, { email: 'ai-viewer@example.test' });
  const viewerTenant: TestTenant = await assignTenantRole(
    database.pool,
    viewer.principalId,
    'ai-viewer',
  );
  const login: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: viewer.email, password: viewer.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const payload: { scopeType: ScopeType; scopePublicId: string; durationHours: number } = {
    scopeType: 'TENANT',
    scopePublicId: tenant.publicId,
    durationHours: 8,
  };
  const anonymous: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/ai-contexts`,
    payload,
  });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  const denied: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${viewerTenant.slug}/ai-contexts`,
    headers: { cookie: String(login.headers['set-cookie']) },
    payload: { ...payload, scopePublicId: viewerTenant.publicId },
  });
  assert.equal(denied.statusCode, 403, denied.body);
  for (const durationHours of [4, 8, 24]) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: `/cookbook/tenants/${tenant.slug}/ai-contexts`,
      headers: { cookie },
      payload: { ...payload, durationHours },
    });
    assert.equal(response.statusCode, 201, response.body);
    const created: { url: string; expiresAt: string } = response.json();
    const stored: QueryResult<{ created_at: Date; expires_at: Date; bootstrap_expires_at: Date }> =
      await database.pool.query(
        'SELECT created_at, expires_at, bootstrap_expires_at FROM ai_context_grant WHERE bootstrap_token_hash = $1',
        [tokenHash(new URL(created.url).pathname.split('/').at(-1)!)],
      );
    assert.equal(
      stored.rows[0]!.expires_at.getTime() - stored.rows[0]!.created_at.getTime(),
      durationHours * 60 * 60 * 1000,
    );
    assert.equal(
      stored.rows[0]!.bootstrap_expires_at.getTime() - stored.rows[0]!.created_at.getTime(),
      30 * 60 * 1000,
    );
    assert.equal(created.expiresAt, stored.rows[0]!.expires_at.toISOString());
  }
  const foreign: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/ai-contexts`,
    headers: { cookie },
    payload: { ...payload, scopeType: 'RECIPE', scopePublicId: foreignRecipeId },
  });
  assert.equal(foreign.statusCode, 404, foreign.body);
  assert.equal(foreign.json<{ code: string }>().code, 'AI_CONTEXT_SCOPE_NOT_FOUND');
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/ai-contexts`,
    headers: { cookie },
    payload: { ...payload, durationHours: 1 },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json<{ code: string }>().code, 'INVALID_AI_CONTEXT');
});

test('concurrent bootstrap requests issue exactly one usable reader token', async (): Promise<void> => {
  const url: string = await createGrant('RECIPE', recipeId);
  const responses: LightMyRequestResponse[] = await Promise.all([
    api.inject({ method: 'GET', url: apiPath(url) }),
    api.inject({ method: 'GET', url: apiPath(url) }),
  ]);
  assert.deepEqual(
    responses.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [200, 404],
  );
  const winner: LightMyRequestResponse | undefined = responses.find(
    (response: LightMyRequestResponse): boolean => response.statusCode === 200,
  );
  assert.ok(winner);
  const manifest: Manifest = winner.json();
  assert.equal((await reader(manifest, 'overview')).statusCode, 200);
});

test('bootstrap links are single-use and reject unknown, expired and revoked tokens', async (): Promise<void> => {
  const url: string = await createGrant('RECIPE', recipeId);
  const bootstrapToken: string = new URL(url).pathname.split('/').at(-1)!;
  const stored: QueryResult<{ bootstrap_token_hash: Buffer; access_token_hash: Buffer | null }> =
    await database.pool.query(
      'SELECT bootstrap_token_hash, access_token_hash FROM ai_context_grant WHERE bootstrap_token_hash = $1',
      [tokenHash(bootstrapToken)],
    );
  assert.equal(stored.rows[0]!.access_token_hash, null);
  await exchange(url);
  await assertError(await api.inject({ method: 'GET', url: apiPath(url) }), 404);
  await assertError(await api.inject({ method: 'GET', url: '/ai-context/unknown' }), 404);
  for (const expiredField of ['bootstrap_expires_at', 'expires_at', 'revoked_at'] as const) {
    const inactiveUrl: string = await createGrant('RECIPE', recipeId);
    const token: string = new URL(inactiveUrl).pathname.split('/').at(-1)!;
    await database.pool.query(
      `UPDATE ai_context_grant SET created_at = now() - interval '2 hours', ${expiredField} = now() - interval '1 hour' WHERE bootstrap_token_hash = $1`,
      [tokenHash(token)],
    );
    await assertError(await api.inject({ method: 'GET', url: apiPath(inactiveUrl) }), 404);
  }
});

test('reader credentials reject missing, malformed, bootstrap, expired and revoked tokens', async (): Promise<void> => {
  const url: string = await createGrant('RECIPE', recipeId);
  const manifest: Manifest = await exchange(url);
  for (const authorization of [
    undefined,
    'Basic invalid',
    'Bearer invalid',
    `Bearer ${new URL(url).pathname.split('/').at(-1)}`,
  ]) {
    for (const endpoint of Object.values(manifest.endpoints)) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url: endpoint.path
          .replace('{publicId}', recipeId)
          .replace('{revisionPublicId}', randomUUID()),
        headers: authorization === undefined ? {} : { authorization },
      });
      await assertError(response, 401);
    }
  }
  for (const field of ['expires_at', 'revoked_at'] as const) {
    const inactive: Manifest = await exchange(await createGrant('RECIPE', recipeId));
    await database.pool.query(
      `UPDATE ai_context_grant SET created_at = now() - interval '2 hours', ${field} = now() - interval '1 hour' WHERE access_token_hash = $1`,
      [tokenHash(inactive.accessToken)],
    );
    await assertError(await reader(inactive, 'overview'), 401);
    await assertError(await reader(inactive, 'overview', recipeId, '', 'query'), 401);
  }
});

test('query credentials reject malformed, repeated, mixed, unknown and bootstrap tokens', async (): Promise<void> => {
  const url: string = await createGrant('RECIPE', recipeId);
  const manifest: Manifest = await exchange(url);
  const bootstrapToken: string = new URL(url).pathname.split('/').at(-1)!;
  const credentials: { query: string; authorization?: string }[] = [
    { query: 'access_token=' },
    { query: 'access_token=bad%20token' },
    { query: 'access_token=unknown' },
    { query: `access_token=${bootstrapToken}` },
    { query: `access_token=${manifest.accessToken}&access_token=${manifest.accessToken}` },
    { query: `access_token=${manifest.accessToken}`, authorization: 'Basic invalid' },
    {
      query: `access_token=${manifest.accessToken}`,
      authorization: `Bearer ${manifest.accessToken}`,
    },
  ];
  for (const credential of credentials) {
    for (const endpoint of Object.values(manifest.endpoints)) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url: `${endpoint.path.replace('{publicId}', recipeId).replace('{revisionPublicId}', randomUUID())}?${credential.query}`,
        headers:
          credential.authorization === undefined ? {} : { authorization: credential.authorization },
      });
      await assertError(response, 401);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
    }
  }
});

test('AI reader credentials cannot authenticate ordinary API reads or writes', async (): Promise<void> => {
  const manifest: Manifest = await exchange(await createGrant('TENANT', tenant.publicId));
  const headers: { authorization: string } = { authorization: `Bearer ${manifest.accessToken}` };
  const recipesBefore: QueryResult<{ count: string }> = await database.pool.query(
    'SELECT count(*) FROM recipe',
  );
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
    const url: string =
      method === 'POST'
        ? `/cookbook/tenants/${tenant.slug}/recipes`
        : `${recipePath(tenant, recipeId)}/draft`;
    const response: LightMyRequestResponse = await api.inject({
      method,
      url,
      headers,
      payload: method === 'POST' || method === 'PATCH' ? {} : undefined,
    });
    assert.equal(response.statusCode, 401, response.body);
    const queryResponse: LightMyRequestResponse = await api.inject({
      method,
      url: `${url}?access_token=${manifest.accessToken}`,
      payload: method === 'POST' || method === 'PATCH' ? {} : undefined,
    });
    assert.equal(queryResponse.statusCode, 401, queryResponse.body);
  }
  assert.equal((await api.inject({ method: 'GET', url: '/admin/users', headers })).statusCode, 401);
  assert.equal(
    (await api.inject({ method: 'GET', url: `/admin/users?access_token=${manifest.accessToken}` }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: `/mcp?access_token=${manifest.accessToken}`,
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await api.inject({ method: 'POST', url: '/ai-context/reader', headers })).statusCode,
    404,
  );
  const recipesAfter: QueryResult<{ count: string }> = await database.pool.query(
    'SELECT count(*) FROM recipe',
  );
  assert.deepEqual(recipesAfter.rows, recipesBefore.rows);
});

async function createGrant(scopeType: ScopeType, scopePublicId: string): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/ai-contexts`,
    headers: { cookie },
    payload: { scopeType, scopePublicId, durationHours: 8 },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ url: string }>().url;
}

async function exchange(url: string): Promise<Manifest> {
  const response: LightMyRequestResponse = await api.inject({ method: 'GET', url: apiPath(url) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  return response.json<Manifest>();
}

async function reader(
  manifest: Manifest,
  name: EndpointName,
  publicId: string = recipeId,
  revisionId: string = '',
  transport: 'header' | 'query' = 'header',
): Promise<LightMyRequestResponse> {
  const path: string = manifest.endpoints[name].path
    .replace('{publicId}', publicId)
    .replace('{revisionPublicId}', revisionId);
  return api.inject({
    method: manifest.endpoints[name].method,
    url:
      transport === 'query'
        ? `${path}?access_token=${encodeURIComponent(manifest.accessToken)}`
        : path,
    headers: transport === 'header' ? { authorization: `Bearer ${manifest.accessToken}` } : {},
  });
}

async function assertError(response: LightMyRequestResponse, status: number): Promise<void> {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json<{ code: string }>().code, 'AI_CONTEXT_UNAVAILABLE');
}

function apiPath(url: string): string {
  assert.ok(url.startsWith(`${publicApiOrigin}/`), url);
  return url.slice(publicApiOrigin.length);
}

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function recipePath(target: TestTenant, publicId: string): string {
  return `/cookbook/tenants/${target.slug}/recipes/${publicId}`;
}

async function createRecipe(
  target: TestTenant,
  category: TestCategory,
  slug: string,
): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${target.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: slug,
      summary: null,
      slug,
      categoryPublicIds: [category.publicId],
      visibilityOverride: 'PRIVATE',
      discoverabilityOverride: 'UNLISTED',
      isFeatured: false,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const publicId: string = response.json<{ publicId: string }>().publicId;
  const steps: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${recipePath(target, publicId)}/draft/steps`,
    headers: { cookie },
    payload: {
      steps: [
        {
          instruction: 'Gründlich umrühren.',
          ingredients: [{ textOverride: 'Salz', amount: '2', note: 'Nach Geschmack' }],
        },
      ],
    },
  });
  assert.equal(steps.statusCode, 204, steps.body);
  await publish(target, publicId);
  return publicId;
}

async function saveDraft(publicId: string, title: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `${recipePath(tenant, publicId)}/draft`,
    headers: { cookie },
    payload: { title, summary: null, categoryPublicIds: [parent.publicId] },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function publish(target: TestTenant, publicId: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${recipePath(target, publicId)}/publish`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
}
