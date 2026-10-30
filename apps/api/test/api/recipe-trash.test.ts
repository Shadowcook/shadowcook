import type { QueryResult } from 'pg';
import { loadCookbookExport } from '../../src/cookbook/export-data.js';
import type { CookbookExport } from '../../src/cookbook/export-types.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestCategory,
  createTestUser,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
import { cleanupRecipeTrash } from '../../src/cookbook/recipe-trash-cleanup.js';
import { cleanupRecipeImages } from '../../src/cookbook/recipe-image-cleanup.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let tenant: TestTenant;
let other: TestTenant;
let cookie: string;
let readerCookie: string;
let instanceCookie: string;
let directory: string;
const previousMediaDirectory: string | undefined = process.env.SHADOWCOOK_MEDIA_DIRECTORY;
let categoryPublicId: string;
interface Recipe {
  publicId: string;
  slug: string;
}

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  directory = await mkdtemp(join(tmpdir(), 'recipe-trash-'));
  process.env.SHADOWCOOK_MEDIA_DIRECTORY = directory;
  api = createTestApi(database.pool);
  await api.ready();
  const admin: TestUser = await createTestUser(database.pool, {
    email: 'trash-admin@example.test',
  });
  tenant = await assignTenantRole(database.pool, admin.principalId, 'trash-tests', [
    'tenant:manage',
    'recipe:delete',
    'recipe:create',
    'recipe:update',
    'recipe:publish',
    'recipe:revision:read',
    'recipe:visibility-update',
  ]);
  other = await assignTenantRole(database.pool, admin.principalId, 'other-trash-tests', [
    'recipe:delete',
  ]);
  categoryPublicId = (
    await createTestCategory(database.pool, tenant.id, 'Recipes', 'trash-recipes')
  ).publicId;
  await database.pool.query(
    "UPDATE tenant SET default_recipe_visibility = 'PUBLIC' WHERE id = $1",
    [tenant.id],
  );
  cookie = await login(admin);
  const reader: TestUser = await createTestUser(database.pool, {
    email: 'trash-reader@example.test',
  });
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [tenant.id, reader.principalId],
  );
  readerCookie = await login(reader);
  const instanceAdmin: TestUser = await createTestUser(database.pool, {
    email: 'trash-instance@example.test',
  });
  const instanceRole: QueryResult = await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, instance_role_id FROM instance_role_permission WHERE permission_code = 'instance:administer' LIMIT 1",
    [instanceAdmin.principalId],
  );
  assert.equal(instanceRole.rowCount, 1);
  instanceCookie = await login(instanceAdmin);
});
after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  if (previousMediaDirectory === undefined) delete process.env.SHADOWCOOK_MEDIA_DIRECTORY;
  else process.env.SHADOWCOOK_MEDIA_DIRECTORY = previousMediaDirectory;
});

test('soft delete hides public, member and private content, history, share links and images while retaining the slug', async (): Promise<void> => {
  for (const visibility of ['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE']) {
    const recipe: Recipe = await createRecipe(
      `hidden-${visibility.toLowerCase().replace('_', '-')}`,
    );
    await database.pool.query('UPDATE recipe SET visibility_override = $1 WHERE public_id = $2', [
      visibility,
      recipe.publicId,
    ]);
    const image: { publicId: string; storageKey: string } = await attachImage(recipe.publicId);
    const shared: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: `${recipePath(recipe)}/share-links`,
      headers: { cookie },
      payload: { name: null, expiresAt: null },
    });
    assert.equal(shared.statusCode, 201, shared.body);
    const sharePath: string = shared.json<{ path: string }>().path;
    const token: string = sharePath.split('/').at(-1)!;
    const grant: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/cookbook/tenants/trash-tests/ai-contexts',
      headers: { cookie },
      payload: { scopeType: 'RECIPE', scopePublicId: recipe.publicId, durationHours: 4 },
    });
    assert.equal(grant.statusCode, 201, grant.body);
    const bootstrap: LightMyRequestResponse = await api.inject({
      url: new URL(grant.json<{ url: string }>().url).pathname,
    });
    assert.equal(bootstrap.statusCode, 200, bootstrap.body);
    const accessToken: string = bootstrap.json<{ accessToken: string }>().accessToken;
    assert.equal((await api.inject({ url: `/cookbook/share-links/${token}` })).statusCode, 200);
    assert.equal(
      (await api.inject({ url: '/cookbook?tenantSlug=trash-tests', headers: { cookie } })).json<{
        canDeleteRecipes: boolean;
      }>().canDeleteRecipes,
      true,
    );
    assert.equal(
      (await api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } }))
        .statusCode,
      204,
    );
    for (const authCookie of ['', readerCookie, cookie]) {
      assert.equal(
        (
          await api.inject({
            url: `/cookbook/recipes/${recipe.publicId}`,
            headers: { cookie: authCookie },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await api.inject({
            url: `/cookbook/media/${image.publicId}`,
            headers: { cookie: authCookie },
          })
        ).statusCode,
        404,
      );
      const overview: LightMyRequestResponse = await api.inject({
        url: '/cookbook?tenantSlug=trash-tests',
        headers: { cookie: authCookie },
      });
      assert.ok(!overview.body.includes(recipe.publicId));
    }
    assert.equal((await api.inject({ url: `/cookbook/share-links/${token}` })).statusCode, 404);
    for (const suffix of ['/draft', '/revisions']) {
      const response: LightMyRequestResponse = await api.inject({
        url: recipePath(recipe) + suffix,
        headers: { cookie },
      });
      assert.ok(response.statusCode === 404 || !response.body.includes('Trash test recipe'));
    }
    assert.equal(
      (
        await api.inject({
          method: 'DELETE',
          url: recipePath(recipe) + '/draft',
          headers: { cookie },
        })
      ).statusCode,
      404,
    );
    const reserved: LightMyRequestResponse = await createResponse(recipe.slug);
    assert.equal(reserved.statusCode, 409, reserved.body);
    assert.equal(
      (
        await api.inject({
          url: `/ai-context/reader/recipes/${recipe.publicId}`,
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).statusCode,
      404,
    );
    assert.ok(
      !(
        await api.inject({
          url: '/ai-context/reader',
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).body.includes('Trash test recipe'),
    );
    const exported: CookbookExport = await loadCookbookExport(database.pool, tenant.id);
    assert.ok(!JSON.stringify(exported).includes(recipe.publicId));
    const trash: LightMyRequestResponse = await api.inject({
      url: '/cookbook/tenants/trash-tests/trash',
      headers: { cookie },
    });
    assert.ok(trash.body.includes(recipe.publicId));
    await cleanupRecipeTrash(database.pool, directory);
    assert.equal(
      (await database.pool.query('SELECT id FROM recipe WHERE public_id = $1', [recipe.publicId]))
        .rowCount,
      1,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: `/cookbook/tenants/trash-tests/trash/${recipe.publicId}/restore`,
          headers: { cookie },
        })
      ).statusCode,
      204,
    );
    assert.equal(
      (await api.inject({ url: `/cookbook/recipes/${recipe.publicId}`, headers: { cookie } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await database.pool.query(
          'SELECT id FROM recipe_revision WHERE recipe_id = (SELECT id FROM recipe WHERE public_id = $1)',
          [recipe.publicId],
        )
      ).rowCount,
      1,
    );
  }
});

test('retention policy belongs to the cookbook admin and is snapshotted at deletion', async (): Promise<void> => {
  const path: string = '/cookbook/tenants/trash-tests/recipe-policy';
  const policy: Record<string, unknown> = (
    await api.inject({ url: path, headers: { cookie } })
  ).json<Record<string, unknown>>();
  assert.equal(policy.recipeRetentionDays, 30);
  for (const value of [0, -1, 1.5, 36501, '30']) {
    assert.equal(
      (
        await api.inject({
          method: 'PATCH',
          url: path,
          headers: { cookie },
          payload: { ...policy, recipeRetentionDays: value },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie: instanceCookie },
        payload: { ...policy, recipeRetentionDays: 1 },
      })
    ).statusCode,
    403,
  );
  const recipe: Recipe = await createRecipe('snapshot');
  await api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } });
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie },
        payload: { ...policy, recipeRetentionDays: 7 },
      })
    ).statusCode,
    204,
  );
  const result: QueryResult<{ deletion_retention_days: number }> = await database.pool.query<{
    deletion_retention_days: number;
  }>('SELECT deletion_retention_days FROM recipe WHERE public_id = $1', [recipe.publicId]);
  assert.equal(result.rows[0]!.deletion_retention_days, 30);
  const next: Recipe = await createRecipe('new-policy');
  await api.inject({ method: 'DELETE', url: recipePath(next), headers: { cookie } });
  assert.equal(
    (
      await database.pool.query<{ deletion_retention_days: number }>(
        'SELECT deletion_retention_days FROM recipe WHERE public_id = $1',
        [next.publicId],
      )
    ).rows[0]!.deletion_retention_days,
    7,
  );
});

test('expired trash purges all revisions, dependent content and files, and releases the slug', async (): Promise<void> => {
  const recipe: Recipe = await createRecipe('expired');
  await api.inject({
    method: 'PATCH',
    url: recipePath(recipe) + '/draft',
    headers: { cookie },
    payload: { title: 'Second version', summary: 'Revised', categoryPublicIds: [categoryPublicId] },
  });
  await api.inject({ method: 'POST', url: recipePath(recipe) + '/publish', headers: { cookie } });
  await api.inject({
    method: 'PATCH',
    url: recipePath(recipe) + '/draft',
    headers: { cookie },
    payload: { title: 'Unpublished changes', summary: null, categoryPublicIds: [categoryPublicId] },
  });
  const revisions: QueryResult<{ id: string }> = await database.pool.query<{ id: string }>(
    'SELECT id FROM recipe_revision WHERE recipe_id = (SELECT id FROM recipe WHERE public_id = $1)',
    [recipe.publicId],
  );
  assert.equal(revisions.rowCount, 3);
  const image: { publicId: string; storageKey: string } = await attachImage(recipe.publicId);
  await api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } });
  await database.pool.query(
    "UPDATE recipe SET deleted_at = now() - interval '31 days', deletion_retention_days = 30 WHERE public_id = $1",
    [recipe.publicId],
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: `/cookbook/tenants/trash-tests/trash/${recipe.publicId}/restore`,
        headers: { cookie },
      })
    ).statusCode,
    404,
  );
  await cleanupRecipeImages(database.pool, directory);
  assert.equal(
    (
      await database.pool.query('SELECT id FROM recipe_revision WHERE id = ANY($1::uuid[])', [
        revisions.rows.map((revision: { id: string }): string => revision.id),
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await database.pool.query('SELECT id FROM recipe WHERE public_id = $1', [recipe.publicId]))
      .rowCount,
    0,
  );
  assert.equal(
    (await database.pool.query('SELECT id FROM media_asset WHERE public_id = $1', [image.publicId]))
      .rowCount,
    0,
  );
  await assert.rejects(access(join(directory, image.storageKey)));
  assert.equal(
    (await database.pool.query('SELECT storage_key FROM recipe_media_deletion_queue')).rowCount,
    0,
  );
  assert.equal((await createResponse(recipe.slug)).statusCode, 201);
  await cleanupRecipeImages(database.pool, directory);
});

test('deletion and restoration enforce tenant permission and tenant scope', async (): Promise<void> => {
  const recipe: Recipe = await createRecipe('permissions');
  for (const authCookie of [readerCookie, instanceCookie]) {
    assert.equal(
      (
        await api.inject({
          method: 'DELETE',
          url: recipePath(recipe),
          headers: { cookie: authCookie },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await api.inject({
          url: '/cookbook/tenants/trash-tests/trash',
          headers: { cookie: authCookie },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: `/cookbook/tenants/trash-tests/trash/${recipe.publicId}/restore`,
          headers: { cookie: authCookie },
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await api.inject({
        method: 'DELETE',
        url: `/cookbook/tenants/${other.slug}/recipes/${recipe.publicId}`,
        headers: { cookie },
      })
    ).statusCode,
    404,
  );
  assert.equal((await api.inject({ method: 'DELETE', url: recipePath(recipe) })).statusCode, 401);
  const concurrent: LightMyRequestResponse[] = await Promise.all([
    api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } }),
    api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } }),
  ]);
  assert.deepEqual(
    concurrent.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [204, 404],
  );
});

test('filesystem failures retain durable cleanup work for retry', async (): Promise<void> => {
  const recipe: Recipe = await createRecipe('file-retry');
  const image: { publicId: string; storageKey: string } = await attachImage(recipe.publicId);
  await api.inject({ method: 'DELETE', url: recipePath(recipe), headers: { cookie } });
  await database.pool.query(
    "UPDATE recipe SET deleted_at = now() - interval '31 days' WHERE public_id = $1",
    [recipe.publicId],
  );
  const blocked: string = join(directory, 'regular-file');
  await writeFile(blocked, 'not a directory');
  await assert.rejects(cleanupRecipeTrash(database.pool, blocked));
  assert.equal(
    (
      await database.pool.query(
        'SELECT storage_key FROM recipe_media_deletion_queue WHERE storage_key = $1',
        [image.storageKey],
      )
    ).rowCount,
    1,
  );
  await access(join(directory, image.storageKey));
  await cleanupRecipeTrash(database.pool, directory);
  await assert.rejects(access(join(directory, image.storageKey)));
  assert.equal(
    (
      await database.pool.query(
        'SELECT storage_key FROM recipe_media_deletion_queue WHERE storage_key = $1',
        [image.storageKey],
      )
    ).rowCount,
    0,
  );
});

function recipePath(recipe: Recipe): string {
  return `/cookbook/tenants/${tenant.slug}/recipes/${recipe.publicId}`;
}
function createResponse(slug: string): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenant.slug}/recipes`,
    headers: { cookie },
    payload: {
      title: 'Trash test recipe',
      summary: 'Original content',
      slug,
      categoryPublicIds: [categoryPublicId],
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: true,
    },
  });
}
async function createRecipe(slug: string): Promise<Recipe> {
  const response: LightMyRequestResponse = await createResponse(slug);
  assert.equal(response.statusCode, 201, response.body);
  const recipe: Recipe = response.json<Recipe>();
  const published: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: recipePath(recipe) + '/publish',
    headers: { cookie },
  });
  assert.equal(published.statusCode, 200, published.body);
  return recipe;
}
async function attachImage(publicId: string): Promise<{ publicId: string; storageKey: string }> {
  const storageKey: string = randomUUID();
  await mkdir(join(directory, storageKey));
  await writeFile(join(directory, storageKey, 'image.jpg'), 'test image');
  await writeFile(join(directory, storageKey, 'thumbnail.jpg'), 'thumbnail');
  const asset: QueryResult<{ id: string; public_id: string }> = await database.pool.query<{
    id: string;
    public_id: string;
  }>(
    "INSERT INTO media_asset (tenant_id, storage_key, content_type, byte_size, checksum) VALUES ($1, $2, 'image/jpeg', 19, $3) RETURNING id, public_id",
    [tenant.id, storageKey, createHash('sha256').update('test image').digest()],
  );
  await database.pool.query(
    "INSERT INTO recipe_revision_media (recipe_revision_id, media_asset_id, usage_kind, sort_order) SELECT published_revision_id, $2, 'COVER', 0 FROM recipe WHERE public_id = $1",
    [publicId, asset.rows[0]!.id],
  );
  return { publicId: asset.rows[0]!.public_id, storageKey };
}
async function login(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers['set-cookie'] as string;
}
