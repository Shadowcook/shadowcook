import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestUser,
  type TestTenant,
  type TestCategory,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
import { cleanupRecipeImages } from '../../src/cookbook/recipe-image-cleanup.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let category: TestCategory;
let cookie: string;
let directory: string;

before(async (): Promise<void> => {
  directory = await mkdtemp(join(tmpdir(), 'shadowcook-image-'));
  process.env.SHADOWCOOK_MEDIA_DIRECTORY = directory;
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  const user: TestUser = await createTestUser(database.pool, { email: 'image@example.test' });
  tenant = await assignTenantRole(database.pool, user.principalId, 'image-test', [
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:visibility-update',
    'recipe:revision:read',
  ]);
  category = await createTestCategory(database.pool, tenant.id, 'Images', 'images');
  const login: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  cookie = String(login.headers['set-cookie']);
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (database) await database.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  delete process.env.SHADOWCOOK_MEDIA_DIRECTORY;
});

test('cover image follows draft publication, authorization, sharing and retained history', async (): Promise<void> => {
  const created: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: 'Image recipe',
      slug: 'image-recipe',
      summary: '',
      categoryPublicIds: [category.publicId],
      visibilityOverride: 'PRIVATE',
      discoverabilityOverride: 'UNLISTED',
      isFeatured: false,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const publicId: string = created.json<{ publicId: string }>().publicId;
  const path: string = `/cookbook/tenants/${tenant.slug}/recipes/${publicId}`;
  const image: Buffer = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#ff0000' },
  })
    .jpeg()
    .toBuffer();
  const unauthorized: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path}/image`,
    payload: { image: image.toString('base64') },
  });
  assert.equal(unauthorized.statusCode, 401);
  const invalid: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path}/image`,
    headers: { cookie },
    payload: { image: Buffer.from('<svg/>').toString('base64') },
  });
  assert.equal(invalid.statusCode, 400);
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path}/image`,
    headers: { cookie },
    payload: { image: image.toString('base64') },
  });
  assert.equal(saved.statusCode, 204, saved.body);
  const draft: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/draft`,
    headers: { cookie },
  });
  const imageUrl: string = draft.json<{ image_url: string }>().image_url.replace(/^\/api/, '');
  assert.equal((await api.inject({ method: 'GET', url: imageUrl })).statusCode, 404);
  const thumbnail: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${imageUrl}?size=thumbnail`,
    headers: { cookie },
  });
  assert.equal(thumbnail.statusCode, 200, thumbnail.body);
  const metadata: sharp.Metadata = await sharp(thumbnail.rawPayload).metadata();
  assert.equal(metadata.width, 360);
  assert.equal(metadata.height, 240);
  assert.equal(metadata.exif, undefined);
  assert.equal(
    (await api.inject({ method: 'POST', url: `${path}/publish`, headers: { cookie } })).statusCode,
    200,
  );
  const share: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path}/share-links`,
    headers: { cookie },
    payload: {},
  });
  assert.equal(share.statusCode, 201, share.body);
  const token: string = share.json<{ token: string }>().token;
  const shared: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/share-links/${token}`,
  });
  assert.equal(shared.statusCode, 200, shared.body);
  const sharedUrl: string = shared.json<{ image_url: string }>().image_url.replace(/^\/api/, '');
  assert.equal((await api.inject({ method: 'GET', url: sharedUrl })).statusCode, 200);
  assert.equal(
    (await api.inject({ method: 'DELETE', url: `${path}/image`, headers: { cookie } })).statusCode,
    204,
  );
  // The published image remains visible while the removal is a draft.
  assert.equal((await api.inject({ method: 'GET', url: sharedUrl })).statusCode, 200);
  assert.equal(
    (await api.inject({ method: 'POST', url: `${path}/publish`, headers: { cookie } })).statusCode,
    200,
  );
  assert.equal((await api.inject({ method: 'GET', url: sharedUrl })).statusCode, 404);
  // Replacing an unpublished upload makes only that unused asset eligible for cleanup.
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url: `${path}/image`,
        headers: { cookie },
        payload: { image: image.toString('base64') },
      })
    ).statusCode,
    204,
  );
  const replacedDraft: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/draft`,
    headers: { cookie },
  });
  const replacedUrl: string = replacedDraft
    .json<{ image_url: string }>()
    .image_url.replace(/^\/api/, '');
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url: `${path}/image`,
        headers: { cookie },
        payload: { image: image.toString('base64') },
      })
    ).statusCode,
    204,
  );
  await database.pool.query("UPDATE media_asset SET created_at = now() - interval '2 days'");
  await cleanupRecipeImages(database.pool, directory);
  const remaining: { rows: { count: number }[] } = await database.pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM media_asset',
  );
  assert.equal(remaining.rows[0]!.count, 2);
  assert.equal(
    (await api.inject({ method: 'GET', url: replacedUrl, headers: { cookie } })).statusCode,
    404,
  );
  assert.equal(
    (await api.inject({ method: 'GET', url: imageUrl, headers: { cookie } })).statusCode,
    200,
  );
});
