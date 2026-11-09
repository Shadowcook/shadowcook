import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let owner: TestUser;
let ownerCookie: string;
let adminCookie: string;
let outsiderCookie: string;
let publicId: string;
let recipePublicId: string;
let shareToken: string;

async function login(user: TestUser): Promise<string> {
  const result: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(result.statusCode, 200);
  return String(result.headers['set-cookie']);
}
async function rename(
  cookie: string,
  displayName: string,
  slug: string,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'PATCH',
    url: `/account/cookbooks/${publicId}`,
    headers: { cookie },
    payload: { displayName, slug },
  });
}
before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  owner = await createTestUser(database.pool, { email: 'identity-owner@example.test' });
  const admin: TestUser = await createTestUser(database.pool, {
    email: 'identity-admin@example.test',
  });
  const outsider: TestUser = await createTestUser(database.pool, {
    email: 'identity-outsider@example.test',
  });
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [admin.principalId],
  );
  ownerCookie = await login(owner);
  adminCookie = await login(admin);
  outsiderCookie = await login(outsider);
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/account/cookbooks',
        headers: { cookie: ownerCookie },
        payload: { cookbookName: 'Original kitchen' },
      })
    ).statusCode,
    201,
  );
  const list: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbooks',
    headers: { cookie: ownerCookie },
  });
  publicId = list.json().cookbooks[0].publicId;
});
after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('only the actual owner can rename; policy and uniqueness are enforced', async (): Promise<void> => {
  assert.equal((await rename('', 'New kitchen', 'new-kitchen')).statusCode, 401);
  assert.equal((await rename(outsiderCookie, 'New kitchen', 'new-kitchen')).statusCode, 404);
  assert.equal((await rename(adminCookie, 'New kitchen', 'new-kitchen')).statusCode, 404);
  const adminUpdate: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/tenants/${publicId}`,
    headers: { cookie: adminCookie },
    payload: { displayName: 'Admin rename', slug: 'admin-rename', disabled: false },
  });
  assert.equal(adminUpdate.statusCode, 400);
  assert.equal((await rename(ownerCookie, 'New kitchen', 'admin')).statusCode, 400);
  await database.pool.query(
    "INSERT INTO tenant (display_name, slug) VALUES ('Taken', 'taken-kitchen')",
  );
  assert.equal((await rename(ownerCookie, 'New kitchen', 'taken-kitchen')).statusCode, 409);
  assert.equal((await rename(ownerCookie, 'Renamed kitchen', 'renamed-kitchen')).statusCode, 204);
  const cookbook: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook?tenantSlug=renamed-kitchen',
    headers: { cookie: ownerCookie },
  });
  assert.equal(cookbook.statusCode, 200);
});

test('published recipes and share links are readable before a reset', async (): Promise<void> => {
  const category = await database.pool.query<{ public_id: string }>(
    "INSERT INTO category (tenant_id, name, slug) SELECT id, 'Meals', 'meals' FROM tenant WHERE public_id = $1 RETURNING public_id",
    [publicId],
  );
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/cookbook/tenants/renamed-kitchen/recipes',
    headers: { cookie: ownerCookie },
    payload: {
      title: 'Soup',
      slug: 'soup',
      summary: null,
      categoryPublicIds: [category.rows[0]!.public_id],
      visibilityOverride: 'PUBLIC',
      discoverabilityOverride: 'DISCOVERABLE',
      isFeatured: false,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  recipePublicId = created.json().publicId;
  const published: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/renamed-kitchen/recipes/${recipePublicId}/publish`,
    headers: { cookie: ownerCookie },
  });
  assert.equal(published.statusCode, 200, published.body);
  const share: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/renamed-kitchen/recipes/${recipePublicId}/share-links`,
    headers: { cookie: ownerCookie },
    payload: { name: 'Sharing', expiresAt: null },
  });
  assert.equal(share.statusCode, 201, share.body);
  shareToken = share.json().token;
  for (const url of [
    `/cookbook/recipes/${recipePublicId}`,
    `/cookbook/share-links/${shareToken}`,
  ]) {
    assert.equal((await api.inject({ method: 'GET', url })).statusCode, 200, url);
  }
});

test('force reset hides the cookbook and forces both identity fields to change, including after a fresh login', async (): Promise<void> => {
  const forbidden: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/admin/tenants/${publicId}/force-reset`,
    headers: { cookie: outsiderCookie },
  });
  assert.equal(forbidden.statusCode, 403);
  const reset: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/admin/tenants/${publicId}/force-reset`,
    headers: { cookie: adminCookie },
  });
  assert.equal(reset.statusCode, 204);
  for (const url of [
    `/cookbook/recipes/${recipePublicId}`,
    `/cookbook/share-links/${shareToken}`,
  ]) {
    assert.equal((await api.inject({ method: 'GET', url })).statusCode, 404, url);
  }
  // Enabling the cookbook cannot bypass the reset lock.
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url: `/admin/tenants/${publicId}`,
        headers: { cookie: adminCookie },
        payload: { disabled: false },
      })
    ).statusCode,
    204,
  );
  for (const cookie of ['', outsiderCookie, adminCookie]) {
    const detail: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/cookbook?tenantSlug=renamed-kitchen',
      headers: { cookie },
    });
    assert.equal(detail.statusCode, 404);
    const listing: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/cookbook/tenants',
      headers: { cookie },
    });
    assert.ok(!JSON.stringify(listing.json()).includes(publicId));
  }
  const owned: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbooks',
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(owned.json().cookbooks, []);
  ownerCookie = await login(owner);
  const session: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(session.json().cookbookResets, [
    { publicId, name: 'Renamed kitchen', slug: 'renamed-kitchen' },
  ]);
  const blocked: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook/tenants',
    headers: { cookie: ownerCookie },
  });
  assert.equal(blocked.json().code, 'COOKBOOK_NAME_RESET_REQUIRED');
  assert.equal((await rename(ownerCookie, 'Renamed kitchen', 'repaired-kitchen')).statusCode, 400);
  assert.equal((await rename(ownerCookie, 'Repaired kitchen', 'renamed-kitchen')).statusCode, 400);
  assert.equal((await rename(ownerCookie, 'Repaired kitchen', 'repaired-kitchen')).statusCode, 204);
  const restored: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook?tenantSlug=repaired-kitchen',
    headers: { cookie: ownerCookie },
  });
  assert.equal(restored.statusCode, 200);
  const sessionAfter: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(sessionAfter.json().cookbookResets, []);
});

test('administrators can cancel a reset independently of deactivation and preserve the identity', async (): Promise<void> => {
  const resetUrl: string = `/admin/tenants/${publicId}/force-reset`;
  for (const [cookie, expected] of [
    ['', 401],
    [outsiderCookie, 403],
    [ownerCookie, 403],
  ] as [string, number][]) {
    const denied: LightMyRequestResponse = await api.inject({
      method: 'DELETE',
      url: resetUrl,
      headers: { cookie },
    });
    assert.equal(denied.statusCode, expected);
  }
  const reset: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: resetUrl,
    headers: { cookie: adminCookie },
  });
  assert.equal(reset.statusCode, 204);
  const list: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { cookie: adminCookie },
  });
  const listed: { name_reset_required: boolean } | undefined = list
    .json()
    .tenants.find((tenant: { public_id: string }): boolean => tenant.public_id === publicId);
  assert.equal(listed?.name_reset_required, true);
  const disable: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/tenants/${publicId}`,
    headers: { cookie: adminCookie },
    payload: { disabled: true },
  });
  assert.equal(disable.statusCode, 204);
  assert.equal(
    (await api.inject({ method: 'DELETE', url: resetUrl, headers: { cookie: adminCookie } }))
      .statusCode,
    204,
  );
  const session: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(session.json().cookbookResets, []);
  const stillDisabled: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook?tenantSlug=repaired-kitchen',
    headers: { cookie: ownerCookie },
  });
  assert.equal(stillDisabled.statusCode, 404);
  const enable: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url: `/admin/tenants/${publicId}`,
    headers: { cookie: adminCookie },
    payload: { disabled: false },
  });
  assert.equal(enable.statusCode, 204);
  const visible: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/cookbook?tenantSlug=repaired-kitchen',
    headers: { cookie: ownerCookie },
  });
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.json().tenant.display_name, 'Repaired kitchen');
  assert.equal(
    (await api.inject({ method: 'DELETE', url: resetUrl, headers: { cookie: adminCookie } }))
      .statusCode,
    204,
  );
  const missing: LightMyRequestResponse = await api.inject({
    method: 'DELETE',
    url: '/admin/tenants/00000000-0000-4000-8000-000000000000/force-reset',
    headers: { cookie: adminCookie },
  });
  assert.equal(missing.statusCode, 404);
});

test('an administrator can undo a reset of their own cookbook', async (): Promise<void> => {
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: adminCookie },
    payload: { cookbookName: 'Administrator kitchen' },
  });
  assert.equal(created.statusCode, 201);
  const owned: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbooks',
    headers: { cookie: adminCookie },
  });
  const ownId: string = owned.json().cookbooks[0].publicId;
  const url: string = `/admin/tenants/${ownId}/force-reset`;
  assert.equal(
    (await api.inject({ method: 'POST', url, headers: { cookie: adminCookie } })).statusCode,
    204,
  );
  assert.equal(
    (await api.inject({ method: 'GET', url: '/admin/tenants', headers: { cookie: adminCookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (await api.inject({ method: 'DELETE', url, headers: { cookie: adminCookie } })).statusCode,
    204,
  );
});

test('forced reset can resolve a generated slug collision with a suffix without bypassing blocked slugs', async (): Promise<void> => {
  const url: string = `/account/cookbooks/${publicId}`;
  const reset: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/admin/tenants/${publicId}/force-reset`,
    headers: { cookie: adminCookie },
  });
  assert.equal(reset.statusCode, 204);
  await database.pool.query(
    "INSERT INTO tenant (display_name, slug, disabled_at) VALUES ('Taken reset URL', 'reset-collision', now())",
  );
  const availability: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${url}/slug-availability?slug=reset-collision`,
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(availability.json(), { available: false, suffixRequired: true });
  for (const blockedSlug of ['admin', 'reset-blocked']) {
    if (blockedSlug === 'reset-blocked')
      await database.pool.query(
        "INSERT INTO instance_cookbook_slug_blocked_term (term) VALUES ('reset-blocked')",
      );
    const blockedAvailability: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `${url}/slug-availability?slug=${blockedSlug}`,
      headers: { cookie: ownerCookie },
    });
    assert.deepEqual(blockedAvailability.json(), { available: false, suffixRequired: false });
    const rejected: LightMyRequestResponse = await api.inject({
      method: 'PATCH',
      url,
      headers: { cookie: ownerCookie },
      payload: { displayName: 'Reset collision', slug: blockedSlug, appendSuffixOnConflict: true },
    });
    assert.equal(rejected.statusCode, 400);
  }
  const manualConflict: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url,
    headers: { cookie: ownerCookie },
    payload: { displayName: 'Reset collision', slug: 'reset-collision' },
  });
  assert.equal(manualConflict.statusCode, 409);
  const unchanged: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: ownerCookie },
  });
  assert.equal(unchanged.json().cookbookResets.length, 1);
  const automatic: LightMyRequestResponse = await api.inject({
    method: 'PATCH',
    url,
    headers: { cookie: ownerCookie },
    payload: {
      displayName: 'Reset collision',
      slug: 'reset-collision',
      appendSuffixOnConflict: true,
    },
  });
  assert.equal(automatic.statusCode, 204, automatic.body);
  const owned: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbooks',
    headers: { cookie: ownerCookie },
  });
  assert.match(owned.json().cookbooks[0].slug, /^reset-collision-[a-f0-9]{8}$/);
  const session: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(session.json().cookbookResets, []);
  const free: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${url}/slug-availability?slug=free-reset-url`,
    headers: { cookie: ownerCookie },
  });
  assert.deepEqual(free.json(), { available: true, suffixRequired: false });
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url,
        headers: { cookie: ownerCookie },
        payload: {
          displayName: 'Free reset URL',
          slug: 'free-reset-url',
          appendSuffixOnConflict: true,
        },
      })
    ).statusCode,
    204,
  );
  const saved: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbooks',
    headers: { cookie: ownerCookie },
  });
  assert.equal(saved.json().cookbooks[0].slug, 'free-reset-url');
});
