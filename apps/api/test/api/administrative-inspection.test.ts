import type { CookbookExport } from '../../src/cookbook/export-types.js';
import { loadCookbookExport } from '../../src/cookbook/export-data.js';
import { cleanupRecipeTrash } from '../../src/cookbook/recipe-trash-cleanup.js';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import {
  createTestUser,
  createTestTenant,
  type TestUser,
  type TestTenant,
} from '../helpers/actors.js';
import { createTestApi } from '../helpers/api.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
let db: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let cookie: string;
let memberCookie: string;
let managerCookie: string;
let directory: string;
let adminPrincipal: string;
let contextToken: string;
let recipe: { id: string; public_id: string };
let revision: { id: string; public_id: string };
let asset: { id: string; public_id: string };
const oldDirectory: string | undefined = process.env.SHADOWCOOK_MEDIA_DIRECTORY;
const bytes: Buffer = Buffer.from([255, 216, 255, 217]);
async function inspect(
  path: string,
  auth: string = cookie,
  payload: object = { reason: 'Investigate private content' },
): Promise<LightMyRequestResponse> {
  return api.inject({ method: 'POST', url: path, headers: { cookie: auth }, payload });
}
function base(): string {
  return `/admin/tenants/${tenant.publicId}`;
}
function detail(): string {
  return `${base()}/recipes/${recipe.public_id}/revisions/${revision.public_id}`;
}
before(async (): Promise<void> => {
  db = await createDisposablePostgresDatabase();
  tenant = await createTestTenant(db.pool, 'inspection-private');
  const admin: TestUser = await createTestUser(db.pool, { email: 'inspection-admin@example.test' });
  adminPrincipal = admin.principalId;
  const member: TestUser = await createTestUser(db.pool, {
    email: 'inspection-member@example.test',
  });
  const manager: TestUser = await createTestUser(db.pool, {
    email: 'inspection-manager@example.test',
  });
  for (const [user, role] of [
    [admin, 'administrator'],
    [manager, 'tenant-manager'],
  ] as [TestUser, string][])
    await db.pool.query(
      'INSERT INTO principal_instance_role SELECT $1, id FROM instance_role WHERE code = $2',
      [user.principalId, role],
    );
  for (const user of [admin, member, manager]) {
    const session: BrowserSession = await issueSession(db.pool, user.userId);
    const value: string = `shadowcook_session=${session.token}`;
    if (user === admin) cookie = value;
    else if (user === member) memberCookie = value;
    else managerCookie = value;
  }
  await db.pool.query('INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)', [
    tenant.id,
    member.principalId,
  ]);
  await db.pool.query('UPDATE tenant SET owner_principal_id = $1 WHERE id = $2', [
    member.principalId,
    tenant.id,
  ]);
  recipe = (
    await db.pool.query<{ id: string; public_id: string }>(
      "INSERT INTO recipe (tenant_id, lineage_public_id, slug, visibility_override) VALUES ($1, gen_random_uuid(), 'private', 'PRIVATE') RETURNING id, public_id",
      [tenant.id],
    )
  ).rows[0]!;
  for (const [number, status] of [
    [2, 'ARCHIVED'],
    [3, 'PUBLISHED'],
  ] as [number, string][]) {
    const old: QueryResult<{ id: string }> = await db.pool.query(
      "INSERT INTO recipe_revision (recipe_id, revision_no, status, title) VALUES ($1, $2, 'DRAFT', 'Published private content') RETURNING id",
      [recipe.id, number],
    );
    await db.pool.query(
      "INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default) VALUES ($1, gen_random_uuid(), 'Published', 'published', true)",
      [old.rows[0]!.id],
    );
    await db.pool.query(
      "WITH c AS (INSERT INTO category (tenant_id, name, slug, sort_order) VALUES ($1, 'Private category', $2, $4) RETURNING id) INSERT INTO recipe_revision_category (recipe_revision_id, category_id) SELECT $3, id FROM c",
      [tenant.id, `private-${number}`, old.rows[0]!.id, number],
    );
    await db.pool.query(
      'UPDATE recipe_revision SET status = $1, published_at = now() WHERE id = $2',
      [status, old.rows[0]!.id],
    );
    if (status === 'PUBLISHED')
      await db.pool.query('UPDATE recipe SET published_revision_id = $1 WHERE id = $2', [
        old.rows[0]!.id,
        recipe.id,
      ]);
  }
  revision = (
    await db.pool.query<{ id: string; public_id: string }>(
      "INSERT INTO recipe_revision (recipe_id, revision_no, status, title) VALUES ($1, 1, 'DRAFT', 'Unpublished private title') RETURNING id, public_id",
      [recipe.id],
    )
  ).rows[0]!;
  await db.pool.query('UPDATE recipe SET draft_revision_id = $1 WHERE id = $2', [
    revision.id,
    recipe.id,
  ]);
  await db.pool.query(
    "INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default) VALUES ($1, gen_random_uuid(), 'Private variant', 'private', true)",
    [revision.id],
  );
  await db.pool.query(
    "WITH s AS (INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction) VALUES ($1, gen_random_uuid(), 0, 'Private instruction') RETURNING id) INSERT INTO recipe_variant_step_override (variant_id, step_id, state) SELECT v.id, s.id, 'INCLUDE' FROM recipe_variant v, s WHERE v.recipe_revision_id = $1",
    [revision.id],
  );
  directory = await mkdtemp(join(tmpdir(), 'shadowcook-inspection-'));
  process.env.SHADOWCOOK_MEDIA_DIRECTORY = directory;
  await mkdir(join(directory, 'test-cover'));
  await writeFile(join(directory, 'test-cover', 'image.jpg'), bytes);
  asset = (
    await db.pool.query<{ id: string; public_id: string }>(
      "INSERT INTO media_asset (tenant_id, storage_key, content_type, byte_size, checksum) VALUES ($1, 'test-cover', 'image/jpeg', $2, $3) RETURNING id, public_id",
      [tenant.id, bytes.length, createHash('sha256').update(bytes).digest()],
    )
  ).rows[0]!;
  await db.pool.query(
    "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, 'COVER')",
    [revision.id, asset.id],
  );
  api = createTestApi(db.pool);
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  if (oldDirectory === undefined) delete process.env.SHADOWCOOK_MEDIA_DIRECTORY;
  else process.env.SHADOWCOOK_MEDIA_DIRECTORY = oldDirectory;
});
test('private, disabled and identity-locked content is inspectable with reason without granting membership', async (): Promise<void> => {
  const beforeMemberships: QueryResult = await db.pool.query(
    'SELECT * FROM tenant_membership ORDER BY principal_id',
  );
  for (const lock of [
    '',
    'disabled_at = now(),',
    'disabled_at = now(), name_reset_required = true,',
  ]) {
    await db.pool.query(
      `UPDATE tenant SET ${lock} description = 'Private cookbook' WHERE id = $1`,
      [tenant.id],
    );
    const overview: LightMyRequestResponse = await inspect(`${base()}/inspection`);
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.json().counts.recipes, 1);
    assert.equal(overview.json().recipes, undefined);
    assert.equal(overview.json().members, undefined);
    const revisions: LightMyRequestResponse = await inspect(
      `${base()}/recipes/${recipe.public_id}/revisions/inspection`,
    );
    assert.equal(revisions.statusCode, 200, revisions.body);
    assert.equal(revisions.json().total, 3);
    for (const item of revisions.json().items)
      assert.equal(
        (
          await inspect(
            `${base()}/recipes/${recipe.public_id}/revisions/${item.public_id}/inspection`,
          )
        ).statusCode,
        200,
      );
    const content: LightMyRequestResponse = await inspect(`${detail()}/inspection`);
    assert.equal(content.statusCode, 200, content.body);
    assert.equal(content.json().steps[0].instruction, 'Private instruction');
    assert.equal(content.json().variants[0].step_keys.length, 1);
    const media: LightMyRequestResponse = await inspect(
      `${detail()}/media/${asset.public_id}/inspection`,
    );
    assert.equal(media.statusCode, 200, media.body);
    assert.deepEqual(media.rawPayload, bytes);
    assert.equal(content.headers['cache-control'], 'private, no-store');
    assert.equal(content.headers['x-robots-tag'], 'noindex, nofollow');
    const audit: QueryResult = await db.pool.query(
      'SELECT * FROM administrative_audit_event WHERE request_id = $1',
      [media.headers['x-request-id']],
    );
    assert.equal(audit.rows[0].media_public_id, asset.public_id);
    assert.equal(audit.rows[0].revision_public_id, revision.public_id);
    assert.equal((await api.inject(`/cookbook/media/${asset.public_id}`)).statusCode, 404);
  }
  assert.deepEqual(
    (await db.pool.query('SELECT * FROM tenant_membership ORDER BY principal_id')).rows,
    beforeMemberships.rows,
  );
  assert.equal(
    (await db.pool.query('SELECT name_reset_required FROM tenant WHERE id = $1', [tenant.id]))
      .rows[0].name_reset_required,
    true,
  );
});
test('direct sensitive reads reject owners, tenant-managers, missing reasons, bearer headers and cross-parent IDs', async (): Promise<void> => {
  for (const path of [
    `${base()}/inspection`,
    `${base()}/inspection/recipes`,
    `${base()}/inspection/members`,
    `${base()}/inspection/reports`,
    `${base()}/recipes/${recipe.public_id}/revisions/inspection`,
    `${detail()}/inspection`,
    `${detail()}/media/${asset.public_id}/inspection`,
  ]) {
    for (const auth of [memberCookie, managerCookie, ''])
      assert.ok([401, 403].includes((await inspect(path, auth)).statusCode));
    assert.equal((await inspect(path, cookie, {})).statusCode, 400);
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: path,
          headers: { cookie, authorization: 'Bearer service-or-oauth' },
          payload: { reason: 'Review' },
        })
      ).statusCode,
      403,
    );
  }
  const foreign: TestTenant = await createTestTenant(db.pool, 'inspection-foreign');
  assert.equal(
    (await inspect(`${detail().replace(tenant.publicId, foreign.publicId)}/inspection`)).statusCode,
    404,
  );
  assert.equal(
    (
      await inspect(
        `${detail().replace(tenant.publicId, foreign.publicId)}/media/${asset.public_id}/inspection`,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await inspect(`${detail().replace(recipe.public_id, randomUUID())}/inspection`)).statusCode,
    404,
  );
  assert.equal((await inspect(`${detail()}/media/${randomUUID()}/inspection`)).statusCode, 404);
  assert.equal(
    (await inspect(`${base().replace(tenant.publicId, randomUUID())}/inspection`)).statusCode,
    404,
  );
});
test('inspection lists are bounded, searchable, paginated, parent-scoped and audited', async (): Promise<void> => {
  for (const kind of ['recipes', 'members', 'reports']) {
    const response: LightMyRequestResponse = await inspect(`${base()}/inspection/${kind}`, cookie, {
      reason: 'Review list',
      pageSize: 1,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().items.length <= 1);
    assert.equal(response.json().pageSize, 1);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    const audit: QueryResult = await db.pool.query(
      'SELECT * FROM administrative_audit_event WHERE request_id=$1',
      [response.headers['x-request-id']],
    );
    assert.equal(audit.rows[0].cookbook_public_id, tenant.publicId);
    for (const payload of [
      { pageSize: 51 },
      { page: 0 },
      { page: 1.5 },
      { query: 'x'.repeat(255) },
      { unexpected: true },
    ])
      assert.equal(
        (await inspect(`${base()}/inspection/${kind}`, cookie, { reason: 'Review', ...payload }))
          .statusCode,
        400,
      );
  }
  const path: string = `${base()}/recipes/${recipe.public_id}/revisions/inspection`;
  const first: LightMyRequestResponse = await inspect(path, cookie, {
    reason: 'Review',
    pageSize: 1,
  });
  const second: LightMyRequestResponse = await inspect(path, cookie, {
    reason: 'Review',
    pageSize: 1,
    page: 2,
  });
  assert.equal(first.json().total, 3);
  assert.equal(first.json().items[0].revision_no, 3);
  assert.equal(second.json().items[0].revision_no, 2);
  const search: LightMyRequestResponse = await inspect(path, cookie, {
    reason: 'Review',
    query: 'Unpublished',
  });
  assert.equal(search.json().items.length, 1);
  assert.equal(search.json().items[0].public_id, revision.public_id);
  const exact: LightMyRequestResponse = await inspect(`${base()}/inspection/recipes`, cookie, {
    reason: 'Review',
    query: recipe.public_id,
  });
  assert.equal(exact.json().items[0].public_id, recipe.public_id);
  const literal: LightMyRequestResponse = await inspect(`${base()}/inspection/recipes`, cookie, {
    reason: 'Review',
    query: '%',
  });
  assert.equal(literal.json().total, 0);
  const empty: LightMyRequestResponse = await inspect(`${base()}/inspection/members`, cookie, {
    reason: 'Review',
    query: 'no-such-account',
  });
  assert.equal(empty.json().total, 0);
  const foreign: TestTenant = await createTestTenant(db.pool, 'inspection-list-foreign');
  assert.equal((await inspect(path.replace(tenant.publicId, foreign.publicId))).statusCode, 404);
  const extra: QueryResult<{ public_id: string }> = await db.pool.query(
    "INSERT INTO recipe (tenant_id,lineage_public_id,slug) VALUES ($1,gen_random_uuid(),'other') RETURNING public_id",
    [foreign.id],
  );
  const ownRecipes: LightMyRequestResponse = await inspect(`${base()}/inspection/recipes`);
  assert.ok(
    !ownRecipes
      .json()
      .items.some(
        (item: { public_id: string }): boolean => item.public_id === extra.rows[0]!.public_id,
      ),
  );
});

test('two thousand memberships return only the requested page with stable ordering', async (): Promise<void> => {
  const large: TestTenant = await createTestTenant(db.pool, 'inspection-large');
  await db.pool.query(
    `WITH principals AS (
    INSERT INTO principal (principal_type) SELECT 'USER' FROM generate_series(1, 2000) RETURNING id
  ), accounts AS (
    INSERT INTO user_account (principal_id,email,display_name,password_hash)
    SELECT id, id::text || '@large.example.test', 'Duplicate display name', 'unused' FROM principals RETURNING principal_id
  ) INSERT INTO tenant_membership (tenant_id,principal_id) SELECT $1, principal_id FROM accounts`,
    [large.id],
  );
  const path: string = `/admin/tenants/${large.publicId}/inspection/members`;
  const first: LightMyRequestResponse = await inspect(path);
  const second: LightMyRequestResponse = await inspect(path, cookie, { reason: 'Review', page: 2 });
  assert.equal(first.json().total, 2000);
  assert.equal(first.json().items.length, 25);
  assert.equal(second.json().items.length, 25);
  const ids: Set<string> = new Set(
    first.json().items.map((item: { public_id: string }): string => item.public_id),
  );
  assert.ok(
    second.json().items.every((item: { public_id: string }): boolean => !ids.has(item.public_id)),
  );
  const last: LightMyRequestResponse = await inspect(path, cookie, { reason: 'Review', page: 80 });
  assert.equal(last.json().items.length, 25);
  const past: LightMyRequestResponse = await inspect(path, cookie, { reason: 'Review', page: 81 });
  assert.equal(past.json().items.length, 0);
});

test('audit insertion failure prevents both content and media release', async (): Promise<void> => {
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_inspection CHECK (action NOT LIKE '%INSPECTED') NOT VALID",
  );
  try {
    for (const path of [
      `${base()}/inspection/recipes`,
      `${base()}/inspection/members`,
      `${base()}/inspection/reports`,
      `${base()}/recipes/${recipe.public_id}/revisions/inspection`,
      `${base()}/inspection`,
      `${detail()}/inspection`,
      `${detail()}/media/${asset.public_id}/inspection`,
    ]) {
      const response: LightMyRequestResponse = await inspect(path);
      assert.equal(response.statusCode, 500);
      assert.ok(!response.body.includes('Private instruction'));
    }
  } finally {
    await db.pool.query('ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_inspection');
  }
});

test('cookbook deactivation closes ordinary share text and already exchanged AI reader grants', async (): Promise<void> => {
  await db.pool.query(
    'UPDATE tenant SET disabled_at = NULL, name_reset_required = false WHERE id = $1',
    [tenant.id],
  );
  const share: string = randomUUID();
  await db.pool.query(
    'INSERT INTO recipe_share_link (recipe_id, token, token_hash) VALUES ($1, $2, $3)',
    [recipe.id, share, createHash('sha256').update(share).digest()],
  );
  const token: string = randomUUID();
  contextToken = token;
  await db.pool.query(
    "INSERT INTO ai_context_grant (tenant_id, created_by_principal_id, scope_type, scope_public_id, bootstrap_token_hash, bootstrap_expires_at, bootstrap_consumed_at, access_token_hash, expires_at) VALUES ($1, $2, 'TENANT', $3, $4, now() + interval '1 hour', now(), $5, now() + interval '1 hour')",
    [
      tenant.id,
      adminPrincipal,
      tenant.publicId,
      createHash('sha256').update(randomUUID()).digest(),
      createHash('sha256').update(token).digest(),
    ],
  );
  const reader: () => Promise<LightMyRequestResponse> = async (): Promise<LightMyRequestResponse> =>
    api.inject({
      method: 'GET',
      url: '/ai-context/reader',
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await api.inject(`/cookbook/share-links/${share}`)).statusCode, 200);
  assert.equal((await reader()).statusCode, 200);
  await db.pool.query('UPDATE tenant SET disabled_at = now() WHERE id = $1', [tenant.id]);
  assert.equal((await api.inject(`/cookbook/share-links/${share}`)).statusCode, 404);
  assert.equal((await reader()).statusCode, 401);
  assert.equal((await inspect(`${base()}/inspection`)).statusCode, 200);
});

test('recipe moderation dominates all ordinary access, publication, exports, trash restore and purge', async (): Promise<void> => {
  await db.pool.query('UPDATE tenant SET disabled_at=NULL,name_reset_required=false WHERE id=$1', [
    tenant.id,
  ]);
  await db.pool.query(
    "WITH r AS (INSERT INTO tenant_role (tenant_id,name) VALUES ($1,'Owner') RETURNING id), p AS (INSERT INTO tenant_role_permission SELECT r.id,permission.code FROM r,permission WHERE code NOT LIKE 'instance:%' AND code <> 'tenant:create') INSERT INTO tenant_membership_role SELECT $1,t.owner_principal_id,r.id FROM r,tenant t WHERE t.id=$1",
    [tenant.id],
  );
  const moderate: (
    blocked: boolean,
    auth?: string,
    purpose?: object,
  ) => Promise<LightMyRequestResponse> = async (
    blocked: boolean,
    auth: string = cookie,
    purpose: object = { reason: 'Investigate', confirmed: true },
  ): Promise<LightMyRequestResponse> =>
    api.inject({
      method: 'POST',
      url: `${base()}/recipes/${recipe.public_id}/moderation`,
      headers: { cookie: auth },
      payload: {
        blocked,
        ...(blocked ? { userReason: 'Content is under moderation review.' } : {}),
        ...purpose,
      },
    });
  assert.equal((await moderate(true, managerCookie)).statusCode, 403);
  assert.equal((await moderate(true, memberCookie)).statusCode, 403);
  assert.equal((await moderate(true, cookie, {})).statusCode, 400);
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_moderation CHECK (action <> 'ADMIN_RECIPE_MODERATED') NOT VALID",
  );
  try {
    assert.equal((await moderate(true)).statusCode, 500);
    assert.equal(
      (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
        .rows[0].moderation_blocked_at,
      null,
    );
  } finally {
    await db.pool.query('ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_moderation');
  }
  const revisions: QueryResult = await db.pool.query(
    'SELECT * FROM recipe_revision WHERE recipe_id=$1 ORDER BY revision_no',
    [recipe.id],
  );
  assert.equal((await moderate(true)).statusCode, 204);
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/cookbook/tenants/${tenant.slug}/recipes/slug-availability?slug=private`,
        headers: { cookie: memberCookie },
      })
    ).json().available,
    false,
  );
  assert.equal((await inspect(`${detail()}/inspection`)).statusCode, 200);
  assert.equal((await inspect(`${detail()}/media/${asset.public_id}/inspection`)).statusCode, 200);
  const share: string = (
    await db.pool.query('SELECT token FROM recipe_share_link WHERE recipe_id=$1', [recipe.id])
  ).rows[0].token;
  for (const auth of ['', memberCookie, cookie]) {
    for (const url of [
      `/cookbook/recipes/${recipe.public_id}`,
      `/cookbook/share-links/${share}`,
      `/cookbook/media/${asset.public_id}`,
      `/cookbook/tenants/${tenant.slug}/recipes/${recipe.public_id}/draft`,
    ]) {
      const response: LightMyRequestResponse = await api.inject({
        method: 'GET',
        url,
        headers: { cookie: auth },
      });
      assert.ok([401, 403, 404].includes(response.statusCode), `${url}: ${response.body}`);
    }
  }
  for (const operation of [
    {
      method: 'POST' as const,
      url: `/cookbook/tenants/${tenant.slug}/recipes/${recipe.public_id}/publish`,
    },
    {
      method: 'DELETE' as const,
      url: `/cookbook/tenants/${tenant.slug}/recipes/${recipe.public_id}`,
    },
  ])
    assert.equal(
      (await api.inject({ ...operation, headers: { cookie: memberCookie } })).statusCode,
      404,
    );
  const exported: CookbookExport = await loadCookbookExport(db.pool, tenant.id);
  assert.equal(exported.recipes.length, 0);
  assert.equal(exported.revisions.length, 0);
  await db.pool.query(
    "UPDATE ai_context_grant SET scope_type='RECIPE',scope_public_id=$2 WHERE access_token_hash=$1",
    [createHash('sha256').update(contextToken).digest(), recipe.public_id],
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: '/ai-context/reader',
        headers: { authorization: `Bearer ${contextToken}` },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await db.pool.query("UPDATE ordinary_recipe SET slug='bypass' WHERE public_id=$1", [
        recipe.public_id,
      ])
    ).rowCount,
    0,
  );
  await db.pool.query(
    "UPDATE recipe SET deleted_at=now()-interval '2 days',deletion_retention_days=1 WHERE id=$1",
    [recipe.id],
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: `/cookbook/tenants/${tenant.slug}/trash/${recipe.public_id}/restore`,
        headers: { cookie: memberCookie },
      })
    ).statusCode,
    404,
  );
  await cleanupRecipeTrash(db.pool, directory);
  assert.equal((await db.pool.query('SELECT 1 FROM recipe WHERE id=$1', [recipe.id])).rowCount, 1);
  assert.equal((await moderate(false)).statusCode, 204);
  assert.ok(
    (await db.pool.query('SELECT deleted_at FROM recipe WHERE id=$1', [recipe.id])).rows[0]
      .deleted_at,
  );
  assert.deepEqual(
    (
      await db.pool.query('SELECT * FROM recipe_revision WHERE recipe_id=$1 ORDER BY revision_no', [
        recipe.id,
      ])
    ).rows,
    revisions.rows,
  );
});

test('cookbook moderation is admin-only, audited, orthogonal to name reset and blocks owner identity mutation', async (): Promise<void> => {
  const change: (disabled: boolean, auth?: string) => Promise<LightMyRequestResponse> = async (
    disabled: boolean,
    auth: string = cookie,
  ): Promise<LightMyRequestResponse> =>
    api.inject({
      method: 'PATCH',
      url: base(),
      headers: { cookie: auth },
      payload: {
        disabled,
        reason: 'Moderation review',
        confirmed: true,
        ...(disabled ? { userReason: 'Content is under moderation review.' } : {}),
      },
    });
  assert.equal((await change(true, managerCookie)).statusCode, 403);
  assert.equal((await change(true, memberCookie)).statusCode, 403);
  await db.pool.query('UPDATE tenant SET name_reset_required=true WHERE id=$1', [tenant.id]);
  assert.equal((await change(true)).statusCode, 204);
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url: `/account/cookbooks/${tenant.publicId}`,
        headers: { cookie: memberCookie },
        payload: { displayName: 'Different name', slug: 'different-name' },
      })
    ).statusCode,
    404,
  );
  assert.equal((await inspect(`${base()}/inspection`)).statusCode, 200);
  assert.equal((await change(false)).statusCode, 204);
  assert.equal(
    (await db.pool.query('SELECT name_reset_required FROM tenant WHERE id=$1', [tenant.id])).rows[0]
      .name_reset_required,
    true,
  );
});
