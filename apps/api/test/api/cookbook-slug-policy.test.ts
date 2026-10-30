import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { reservedCookbookSlugs } from '../../src/cookbook/slug-policy.js';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administratorCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'slug-administrator@example.test',
  });
  await database.pool.query(
    `INSERT INTO principal_instance_role (principal_id, instance_role_id)
     SELECT $1, id FROM instance_role WHERE code = 'administrator'`,
    [administrator.principalId],
  );
  const response = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: administrator.email, password: administrator.password },
  });
  administratorCookie = String(response.headers['set-cookie']);
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('blocked terms apply to cookbook URL previews and are administered by instance administrators', async (): Promise<void> => {
  const create = await api.inject({
    method: 'POST',
    url: '/admin/cookbook-slug-blocked-terms',
    headers: { cookie: administratorCookie },
    payload: { term: 'adult' },
  });
  const preview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=My%20Adult%20Kitchen',
  });
  const list = await api.inject({
    method: 'GET',
    url: '/admin/cookbook-slug-blocked-terms',
    headers: { cookie: administratorCookie },
  });
  const remove = await api.inject({
    method: 'DELETE',
    url: '/admin/cookbook-slug-blocked-terms/adult',
    headers: { cookie: administratorCookie },
  });

  assert.equal(create.statusCode, 201);
  assert.deepEqual(create.json(), { term: 'adult' });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json(), { slug: 'my-adult-kitchen', available: false });
  assert.deepEqual(list.json(), { terms: ['adult'] });
  assert.equal(remove.statusCode, 204);
});

test('hardcoded reserved cookbook URL namespaces are unavailable', async (): Promise<void> => {
  for (const slug of reservedCookbookSlugs) {
    const preview: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: `/account/cookbook-slug-preview?cookbookName=${encodeURIComponent(slug)}`,
    });
    assert.equal(preview.statusCode, 200, slug);
    assert.deepEqual(preview.json(), { slug, available: false }, slug);

    const creation: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/account/cookbooks',
      headers: { cookie: administratorCookie },
      payload: { cookbookName: slug },
    });
    assert.equal(creation.statusCode, 400, slug);
    assert.equal(creation.json().code, 'COOKBOOK_SLUG_BLOCKED', slug);
  }
});

test('cookbook names are trimmed and require an alphanumeric start and three alphanumeric characters', async (): Promise<void> => {
  const invalidPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=-abc',
  });
  const insufficientPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=a--b',
  });
  const trimmedPreview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=%20%20Ab-c%20%20',
  });

  assert.equal(invalidPreview.statusCode, 400);
  assert.equal(insufficientPreview.statusCode, 400);
  assert.equal(trimmedPreview.statusCode, 200);
  assert.deepEqual(trimmedPreview.json(), { slug: 'ab-c', available: true });
});

test('account cookbook creation rejects a slug containing a blocked term', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'blocked-cookbook-owner@example.test',
  });
  await database.pool.query(
    `INSERT INTO instance_cookbook_slug_blocked_term (term, created_by_principal_id)
     VALUES ('restricted', NULL)`,
  );
  const login = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  const response = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: String(login.headers['set-cookie']) },
    payload: { cookbookName: 'Restricted dishes' },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    code: 'COOKBOOK_SLUG_BLOCKED',
    error: 'The cookbook slug is unavailable.',
  });
});

test('Explore is unavailable in previews, account creation, and admin slug updates', async (): Promise<void> => {
  const preview = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=Explore',
  });
  assert.deepEqual(preview.json(), { slug: 'explore', available: false });
  const create = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: administratorCookie },
    payload: { cookbookName: 'Explore' },
  });
  assert.equal(create.statusCode, 400);
  assert.equal(create.json().code, 'COOKBOOK_SLUG_BLOCKED');
  const tenant = await database.pool.query<{ public_id: string }>(
    "INSERT INTO tenant (display_name, slug) VALUES ('Slug safety', 'slug-safety') RETURNING public_id",
  );
  const update = await api.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenant.rows[0]!.public_id}`,
    headers: { cookie: administratorCookie },
    payload: { slug: 'explore' },
  });
  assert.equal(update.statusCode, 400);
  const remaining = await database.pool.query<{ slug: string }>(
    'SELECT slug FROM tenant WHERE public_id = $1',
    [tenant.rows[0]!.public_id],
  );
  assert.equal(remaining.rows[0]?.slug, 'slug-safety');
});

test('Explore is rejected by registration and administrator creation without persisting a cookbook', async (): Promise<void> => {
  const registration = await api.inject({
    method: 'POST',
    url: '/registration',
    payload: {
      firstName: 'Test',
      lastName: 'Cook',
      displayName: 'Test Cook',
      email: 'explore-registration@example.test',
      password: 'A strong password is not evaluated for blocked slugs.',
      tenantName: 'Explore',
      turnstileToken: '',
      website: '',
    },
  });
  assert.equal(registration.statusCode, 400);
  assert.equal(registration.json().code, 'INVALID_REGISTRATION');
  await database.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id) SELECT 'smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', principal_id FROM user_account WHERE email = 'slug-administrator@example.test'",
  );
  const creation = await api.inject({
    method: 'POST',
    url: '/admin/tenants',
    headers: { cookie: administratorCookie },
    payload: { email: 'explore-owner@example.test', cookbookName: 'Explore', slug: 'explore' },
  });
  assert.equal(creation.statusCode, 400);
  assert.equal(creation.json().code, 'INVALID_TENANT_SLUG');
  const result = await database.pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM tenant WHERE slug = 'explore'",
  );
  assert.equal(result.rows[0]?.count, 0);
});

test('Landing is unavailable in previews and account creation while landing-kitchen remains available', async (): Promise<void> => {
  const preview: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=Landing',
  });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json(), { slug: 'landing', available: false });
  const creation: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/account/cookbooks',
    headers: { cookie: administratorCookie },
    payload: { cookbookName: 'Landing' },
  });
  assert.equal(creation.statusCode, 400);
  assert.equal(creation.json().code, 'COOKBOOK_SLUG_BLOCKED');
  const prefixedPreview: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/cookbook-slug-preview?cookbookName=Landing%20Kitchen',
  });
  assert.equal(prefixedPreview.statusCode, 200);
  assert.deepEqual(prefixedPreview.json(), { slug: 'landing-kitchen', available: true });
});
