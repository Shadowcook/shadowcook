import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
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
import { cleanupRecipeImages } from '../../src/cookbook/recipe-image-cleanup.js';
import { pruneRecipeImageHistory } from '../../src/cookbook/recipe-image-retention.js';
import { loadCookbookExport } from '../../src/cookbook/export-data.js';
import type { CookbookExport, ExportRevision } from '../../src/cookbook/export-types.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let category: TestCategory;
let cookie: string;
let directory: string;
const previousDirectory: string | undefined = process.env.SHADOWCOOK_MEDIA_DIRECTORY;

before(async (): Promise<void> => {
  directory = await mkdtemp(join(tmpdir(), 'shadowcook-image-retention-'));
  process.env.SHADOWCOOK_MEDIA_DIRECTORY = directory;
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  const user: TestUser = await createTestUser(database.pool, { email: 'retention@example.test' });
  tenant = await assignTenantRole(database.pool, user.principalId, 'retention-test', [
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:revision:read',
    'recipe:visibility-update',
  ]);
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [user.principalId],
  );
  category = await createTestCategory(database.pool, tenant.id, 'Retention', 'retention');
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
  if (previousDirectory === undefined) delete process.env.SHADOWCOOK_MEDIA_DIRECTORY;
  else process.env.SHADOWCOOK_MEDIA_DIRECTORY = previousDirectory;
});

async function createRecipe(slug: string): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: slug,
      slug,
      summary: 'Retain the recipe text',
      categoryPublicIds: [category.publicId],
      visibilityOverride: 'PUBLIC',
      discoverabilityOverride: 'DISCOVERABLE',
      isFeatured: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `/cookbook/tenants/${tenant.slug}/recipes/${response.json<{ publicId: string }>().publicId}`;
}

async function imageBytes(index: number): Promise<Buffer> {
  return sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: index * 20, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

async function upload(path: string, index: number): Promise<string> {
  const bytes: Buffer = await imageBytes(index);
  const saved: LightMyRequestResponse = await api.inject({
    method: 'PUT',
    url: `${path}/image`,
    headers: { cookie },
    payload: { image: bytes.toString('base64') },
  });
  assert.equal(saved.statusCode, 204, saved.body);
  const draft: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/draft`,
    headers: { cookie },
  });
  return draft.json<{ image_url: string }>().image_url.replace(/^\/api/, '');
}

async function publish(path: string): Promise<void> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `${path}/publish`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
}

test('publishing retains five distinct images plus the active draft and preserves all recipe revisions', async (): Promise<void> => {
  const path: string = await createRecipe('publication-retention');
  const publicId: string = path.split('/').at(-1)!;
  const images: string[] = [await upload(path, 1)];
  await publish(path);
  // Repeated text-only publication must not consume image-history slots.
  for (let index: number = 0; index < 6; index += 1) {
    const changed: LightMyRequestResponse = await api.inject({
      method: 'PATCH',
      url: `${path}/draft`,
      headers: { cookie },
      payload: {
        title: `Tuned ${index}`,
        summary: 'Retain the recipe text',
        categoryPublicIds: [category.publicId],
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    await publish(path);
  }
  assert.equal(
    (await api.inject({ method: 'GET', url: images[0]!, headers: { cookie } })).statusCode,
    200,
  );
  assert.equal((await readdir(directory)).length, 1);
  for (let index: number = 2; index <= 5; index += 1) {
    images.push(await upload(path, index));
    await publish(path);
  }
  images.push(await upload(path, 6));
  assert.equal(
    (await api.inject({ method: 'GET', url: images[0]!, headers: { cookie } })).statusCode,
    200,
  );
  await publish(path);
  assert.equal(
    (await api.inject({ method: 'GET', url: images[0]!, headers: { cookie } })).statusCode,
    404,
  );
  assert.equal((await readdir(directory)).length, 5);
  for (const image of images.slice(1)) {
    assert.equal(
      (await api.inject({ method: 'GET', url: image, headers: { cookie } })).statusCode,
      200,
    );
  }
  const draftImage: string = await upload(path, 7);
  await cleanupRecipeImages(database.pool, directory);
  assert.equal(
    (await api.inject({ method: 'GET', url: draftImage, headers: { cookie } })).statusCode,
    200,
  );
  assert.equal((await readdir(directory)).length, 6);
  const exported: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
  const revisions: ExportRevision[] = exported.revisions.filter(
    (revision: ExportRevision): boolean => revision.recipe_public_id === publicId,
  );
  assert.equal(revisions.length, 13);
  assert.equal(
    revisions.filter((revision: ExportRevision): boolean => revision.image === null).length,
    7,
  );
  assert.ok(
    revisions.every(
      (revision: ExportRevision): boolean => revision.summary === 'Retain the recipe text',
    ),
  );
  assert.ok(
    revisions.find((revision: ExportRevision): boolean => revision.status === 'DRAFT')!.image,
  );
  const history: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/revisions`,
    headers: { cookie },
  });
  assert.equal(history.json<{ revisions: object[] }>().revisions.length, 12);
  const oldest: ExportRevision = revisions[0]!;
  const snapshot: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `${path}/revisions/${oldest.public_id}`,
    headers: { cookie },
  });
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.equal(snapshot.json<{ image_url: string | null }>().image_url, null);
  assert.equal(snapshot.json<{ title: string }>().title, 'publication-retention');
});

interface SeededImage {
  id: string;
  storageKey: string;
}

test('periodic cleanup prunes existing history while preserving draft and shared references', async (): Promise<void> => {
  const recipe: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
    `INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, gen_random_uuid(), 'legacy-retention') RETURNING id`,
    [tenant.id],
  );
  const recipeId: string = recipe.rows[0]!.id;
  const images: SeededImage[] = [];
  let publishedId: string = '';
  for (let index: number = 0; index < 8; index += 1) {
    const bytes: Buffer = await imageBytes(index);
    const storageKey: string = randomUUID();
    await mkdir(join(directory, storageKey));
    await writeFile(join(directory, storageKey, 'image.jpg'), bytes);
    await writeFile(join(directory, storageKey, 'thumbnail.jpg'), bytes);
    const asset: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
      `INSERT INTO media_asset (tenant_id, storage_key, content_type, byte_size, checksum) VALUES ($1, $2, 'image/jpeg', $3, $4) RETURNING id`,
      [tenant.id, storageKey, bytes.length * 2, createHash('sha256').update(bytes).digest()],
    );
    images.push({ id: asset.rows[0]!.id, storageKey });
    const revision: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
      `WITH revision AS (
         INSERT INTO recipe_revision (recipe_id, revision_no, status, title, published_at)
         VALUES ($1, $2, $3, 'Legacy retained text', now()) RETURNING id
       ), category_assignment AS (
         INSERT INTO recipe_revision_category (recipe_revision_id, category_id)
         SELECT revision.id, category.id FROM revision CROSS JOIN category WHERE category.public_id = $4
       ) SELECT id FROM revision`,
      [recipeId, index + 1, index === 7 ? 'PUBLISHED' : 'ARCHIVED', category.publicId],
    );
    publishedId = revision.rows[0]!.id;
    await database.pool.query(
      "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, 'COVER')",
      [publishedId, asset.rows[0]!.id],
    );
  }
  const draft: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
    "INSERT INTO recipe_revision (recipe_id, revision_no, status, title) VALUES ($1, 9, 'DRAFT', 'Protected draft') RETURNING id",
    [recipeId],
  );
  await database.pool.query(
    'UPDATE recipe SET published_revision_id = $2, draft_revision_id = $3 WHERE id = $1',
    [recipeId, publishedId, draft.rows[0]!.id],
  );
  await database.pool.query(
    "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, 'COVER')",
    [draft.rows[0]!.id, images[0]!.id],
  );
  // Another recipe retains the second-oldest image independently.
  const sharedPath: string = await createRecipe('shared-retained-image');
  const sharedPublicId: string = sharedPath.split('/').at(-1)!;
  await database.pool.query(
    "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind) SELECT draft_revision_id, $2, 'COVER' FROM recipe WHERE public_id = $1",
    [sharedPublicId, images[1]!.id],
  );
  await publish(sharedPath);
  // Database rollback must preserve both image references and their files.
  const client: PoolClient = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM recipe WHERE id = $1 FOR UPDATE', [recipeId]);
    assert.deepEqual(await pruneRecipeImageHistory(client, recipeId), [images[2]!.storageKey]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const restored: QueryResult<{ count: number }> = await database.pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM recipe_revision_media AS media
     INNER JOIN recipe_revision AS revision ON revision.id = media.recipe_revision_id
     WHERE revision.recipe_id = $1`,
    [recipeId],
  );
  assert.equal(restored.rows[0]!.count, 9);
  assert.ok((await stat(join(directory, images[2]!.storageKey))).isDirectory());
  await cleanupRecipeImages(database.pool, directory);
  const archived: QueryResult<{ revision_no: number; media_asset_id: string | null }> =
    await database.pool.query<{ revision_no: number; media_asset_id: string | null }>(
      `SELECT revision.revision_no, media.media_asset_id FROM recipe_revision AS revision
     LEFT JOIN recipe_revision_media AS media ON media.recipe_revision_id = revision.id AND media.usage_kind = 'COVER'
     WHERE revision.recipe_id = $1 ORDER BY revision.revision_no`,
      [recipeId],
    );
  assert.equal(archived.rows.length, 9);
  assert.equal(archived.rows[0]!.media_asset_id, null);
  assert.equal(archived.rows[1]!.media_asset_id, null);
  assert.equal(archived.rows[2]!.media_asset_id, null);
  assert.equal(archived.rows[8]!.media_asset_id, images[0]!.id);
  for (const image of images.filter((item: SeededImage): boolean => item !== images[2]))
    assert.ok((await stat(join(directory, image.storageKey))).isDirectory());
  await assert.rejects(stat(join(directory, images[2]!.storageKey)), { code: 'ENOENT' });
  // Releasing the independent reference allows ordinary orphan cleanup to remove it.
  await database.pool.query('DELETE FROM recipe_revision_media WHERE media_asset_id = $1', [
    images[1]!.id,
  ]);
  await database.pool.query(
    "UPDATE media_asset SET created_at = now() - interval '2 days' WHERE id = $1",
    [images[1]!.id],
  );
  await cleanupRecipeImages(database.pool, directory);
  await assert.rejects(stat(join(directory, images[1]!.storageKey)), { code: 'ENOENT' });
  assert.ok((await stat(join(directory, images[0]!.storageKey))).isDirectory());
});

test('configured unlimited and minimum limits govern publication and cleanup without disabling orphan collection', async (): Promise<void> => {
  async function setLimit(limit: number): Promise<void> {
    const result: LightMyRequestResponse = await api.inject({
      method: 'PUT',
      url: '/admin/media-settings',
      headers: { cookie },
      payload: { maxPublishedRecipeImages: limit },
    });
    assert.equal(result.statusCode, 204, result.body);
  }
  const path: string = await createRecipe('configurable-retention');
  const images: string[] = [];
  await setLimit(0);
  try {
    for (let index: number = 0; index < 7; index += 1) {
      images.push(await upload(path, index));
      await publish(path);
    }
    const orphan: string = await upload(path, 8);
    const draftImage: string = await upload(path, 9);
    await database.pool.query(
      "UPDATE media_asset SET created_at = now() - interval '2 days' WHERE public_id = $1",
      [orphan.split('/').at(-1)],
    );
    await cleanupRecipeImages(database.pool, directory);
    assert.equal(
      (await api.inject({ method: 'GET', url: orphan, headers: { cookie } })).statusCode,
      404,
    );
    for (const image of [...images, draftImage]) {
      assert.equal(
        (await api.inject({ method: 'GET', url: image, headers: { cookie } })).statusCode,
        200,
      );
    }
    await setLimit(1);
    await cleanupRecipeImages(database.pool, directory);
    for (const image of images.slice(0, -1)) {
      assert.equal(
        (await api.inject({ method: 'GET', url: image, headers: { cookie } })).statusCode,
        404,
      );
    }
    assert.equal(
      (await api.inject({ method: 'GET', url: images.at(-1)!, headers: { cookie } })).statusCode,
      200,
    );
    assert.equal(
      (await api.inject({ method: 'GET', url: draftImage, headers: { cookie } })).statusCode,
      200,
    );
    await publish(path);
    assert.equal(
      (await api.inject({ method: 'GET', url: images.at(-1)!, headers: { cookie } })).statusCode,
      404,
    );
    assert.equal(
      (await api.inject({ method: 'GET', url: draftImage, headers: { cookie } })).statusCode,
      200,
    );
    await setLimit(3);
    assert.equal(
      (await api.inject({ method: 'GET', url: images[0]!, headers: { cookie } })).statusCode,
      404,
    );
  } finally {
    await setLimit(5);
  }
});
