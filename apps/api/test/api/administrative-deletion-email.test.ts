import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import nodemailer from 'nodemailer';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { QueryResult } from 'pg';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import { cleanupRecipeTrash } from '../../src/cookbook/recipe-trash-cleanup.js';
import { createTestApi } from '../helpers/api.js';
import {
  createTestTenant,
  createTestUser,
  type TestTenant,
  type TestUser,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface Fixture {
  tenant: TestTenant;
  recipe: { id: string; public_id: string };
}
interface Mail {
  to: string;
  subject: string;
  text: string;
}
let db: DisposablePostgresDatabase;
let api: FastifyInstance;
let admin: TestUser;
let owner: TestUser;
let adminCookie: string;
let ownerCookie: string;
let managerCookie: string;
async function session(user: TestUser): Promise<string> {
  const value: BrowserSession = await issueSession(db.pool, user.userId);
  return `shadowcook_session=${value.token}`;
}
async function smtp(): Promise<void> {
  await db.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host,smtp_port,transport_security,from_email,from_name,updated_by_principal_id) VALUES ('smtp.invalid',587,'STARTTLS','noreply@example.test','Shadowcook',$1)",
    [admin.principalId],
  );
}
async function fixture(): Promise<Fixture> {
  const tenant: TestTenant = await createTestTenant(db.pool, `deletion-${randomUUID()}`);
  await db.pool.query('INSERT INTO tenant_membership (tenant_id,principal_id) VALUES ($1,$2)', [
    tenant.id,
    owner.principalId,
  ]);
  await db.pool.query(
    'UPDATE tenant SET owner_principal_id=$1, disabled_at=now(), name_reset_required=true WHERE id=$2',
    [owner.principalId, tenant.id],
  );
  const result: QueryResult<{ id: string; public_id: string }> = await db.pool.query(
    "INSERT INTO recipe (tenant_id,lineage_public_id,slug,moderation_blocked_at) VALUES ($1,gen_random_uuid(),'suppe',now()) RETURNING id, public_id",
    [tenant.id],
  );
  const recipe: { id: string; public_id: string } = result.rows[0]!;
  await db.pool.query(
    "INSERT INTO recipe_revision (recipe_id,revision_no,status,title,created_by_principal_id) VALUES ($1,1,'DRAFT','Kürbissuppe',$2)",
    [recipe.id, admin.principalId],
  );
  return { tenant, recipe };
}
function capture(context: TestContext, messages: Mail[]): void {
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (message: Mail): Promise<object> => {
      messages.push(message);
      return {};
    },
  }));
}
before(async (): Promise<void> => {
  db = await createDisposablePostgresDatabase();
  api = createTestApi(db.pool);
  admin = await createTestUser(db.pool, { email: 'deletion-admin@example.test' });
  owner = await createTestUser(db.pool, { email: 'deletion-owner@example.test' });
  const manager: TestUser = await createTestUser(db.pool, {
    email: 'deletion-manager@example.test',
  });
  for (const [user, role] of [
    [admin, 'administrator'],
    [manager, 'tenant-manager'],
  ] as [TestUser, string][])
    await db.pool.query(
      'INSERT INTO principal_instance_role SELECT $1,id FROM instance_role WHERE code=$2',
      [user.principalId, role],
    );
  adminCookie = await session(admin);
  ownerCookie = await session(owner);
  managerCookie = await session(manager);
  await smtp();
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
});

const kinds: readonly ('recipe' | 'cookbook')[] = ['recipe', 'cookbook'];
for (const kind of kinds) {
  const templateKey: string = kind === 'recipe' ? 'RECIPE_DELETED' : 'COOKBOOK_DELETED';
  function path(item: Fixture): string {
    return `/admin/tenants/${item.tenant.publicId}${kind === 'recipe' ? `/recipes/${item.recipe.public_id}` : ''}`;
  }
  function target(item: Fixture): string {
    return kind === 'recipe' ? item.recipe.public_id : item.tenant.publicId;
  }
  async function payload(item: Fixture): Promise<object> {
    const preview: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: `${path(item)}/deletion-preview`,
      headers: { cookie: adminCookie },
      payload: { reason: 'Internal preservation review' },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    return {
      reason: 'Internal investigation details',
      confirmation: target(item),
      preservationReviewed: true,
      expectedScope: preview.json(),
    };
  }
  async function remove(
    item: Fixture,
    body: object,
    auth: string = adminCookie,
  ): Promise<LightMyRequestResponse> {
    return api.inject({
      method: 'DELETE',
      url: path(item),
      headers: { cookie: auth },
      payload: body,
    });
  }
  async function exists(item: Fixture): Promise<boolean> {
    return (
      (
        await db.pool.query(
          kind === 'recipe'
            ? 'SELECT 1 FROM recipe WHERE id=$1'
            : 'SELECT 1 FROM tenant WHERE id=$1',
          [kind === 'recipe' ? item.recipe.id : item.tenant.id],
        )
      ).rowCount === 1
    );
  }

  test(`admin ${kind} deletion permanently removes rows and sends one owner email only after audit and deletion commit`, async (context: TestContext): Promise<void> => {
    const item: Fixture = await fixture();
    const messages: Mail[] = [];
    capture(context, messages);
    const body: object = await payload(item);
    assert.equal(messages.length, 0);
    context.mock.restoreAll();
    context.mock.method(nodemailer, 'createTransport', (): object => ({
      sendMail: async (message: Mail): Promise<object> => {
        assert.equal(await exists(item), false);
        assert.equal(
          (
            await db.pool.query('SELECT 1 FROM recipe_revision WHERE recipe_id=$1', [
              item.recipe.id,
            ])
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action=$2',
              [target(item), `ADMIN_${kind.toUpperCase()}_DELETED`],
            )
          ).rowCount,
          1,
        );
        messages.push(message);
        return {};
      },
    }));
    assert.equal(
      (await remove(item, { ...body, userReason: '  Removed after review.  ' })).statusCode,
      204,
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, owner.email);
    assert.equal(
      messages[0]!.subject,
      kind === 'recipe'
        ? 'Recipe permanently deleted: Kürbissuppe'
        : 'Cookbook permanently deleted: Test tenant',
    );
    assert.ok(messages[0]!.text.includes(target(item)));
    assert.ok(messages[0]!.text.includes('Removed after review.'));
    assert.ok(!messages[0]!.text.includes('  Removed'));
    assert.ok(!messages[0]!.text.includes('Internal investigation details'));
    assert.ok(!messages[0]!.text.includes('http'));
    assert.equal(
      (await db.pool.query('SELECT 1 FROM user_account WHERE id=$1', [owner.userId])).rowCount,
      1,
    );
    assert.equal(
      (await db.pool.query('SELECT 1 FROM tenant_membership WHERE tenant_id=$1', [item.tenant.id]))
        .rowCount,
      kind === 'recipe' ? 1 : 0,
    );
    assert.equal((await remove(item, body)).statusCode, 404);
    assert.equal(messages.length, 1);
  });

  test(`${kind} denied, invalid, stale and rolled-back deletions send no email`, async (context: TestContext): Promise<void> => {
    const item: Fixture = await fixture();
    const messages: Mail[] = [];
    capture(context, messages);
    const body: object = await payload(item);
    for (const auth of ['', ownerCookie, managerCookie])
      assert.ok([401, 403].includes((await remove(item, body, auth)).statusCode));
    for (const userReason of [null, false, 12, '😀'.repeat(2001)])
      assert.equal((await remove(item, { ...body, userReason })).statusCode, 400);
    assert.equal((await remove(item, { ...body, confirmation: 'wrong' })).statusCode, 400);
    const stale: object = {
      recipeCount: 999,
      revisionCount: 0,
      shareCount: 0,
      mediaCount: 0,
      memberCount: 0,
    };
    assert.equal((await remove(item, { ...body, expectedScope: stale })).statusCode, 409);
    await db.pool.query(
      `ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_delete_email CHECK (action <> 'ADMIN_${kind.toUpperCase()}_DELETED') NOT VALID`,
    );
    try {
      assert.equal((await remove(item, body)).statusCode, 500);
      assert.equal(await exists(item), true);
    } finally {
      await db.pool.query(
        'ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_delete_email',
      );
    }
    // A failure inside the actual delete, after its audit insert, must roll back both and send nothing.
    await db.pool.query(
      "CREATE FUNCTION reject_delete_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated cascade failure'; END $$",
    );
    await db.pool.query(
      `CREATE TRIGGER reject_delete_email BEFORE DELETE ON ${kind === 'recipe' ? 'recipe' : 'tenant'} FOR EACH ROW EXECUTE FUNCTION reject_delete_email()`,
    );
    try {
      assert.equal((await remove(item, body)).statusCode, 500);
      assert.equal(await exists(item), true);
      assert.equal(
        (
          await db.pool.query(
            'SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action=$2',
            [target(item), `ADMIN_${kind.toUpperCase()}_DELETED`],
          )
        ).rowCount,
        0,
      );
    } finally {
      await db.pool.query(
        `DROP TRIGGER reject_delete_email ON ${kind === 'recipe' ? 'recipe' : 'tenant'}`,
      );
      await db.pool.query('DROP FUNCTION reject_delete_email()');
    }
    assert.equal(messages.length, 0);
  });

  test(`${kind} deletion email supports customized templates and optional explanations`, async (context: TestContext): Promise<void> => {
    const headers: { cookie: string } = { cookie: adminCookie };
    const url: string = `/admin/email-templates/${templateKey}`;
    const listing: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/admin/email-templates',
      headers,
    });
    assert.ok(
      listing.json().templates.some((value: { key: string }): boolean => value.key === templateKey),
    );
    assert.equal(
      (
        await api.inject({
          method: 'PUT',
          url,
          headers,
          payload: { subject: '{{reason}}', body: '{{description}}' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await api.inject({
          method: 'PUT',
          url,
          headers,
          payload: {
            subject: 'Gelöscht: {{cookbook_name}}',
            body: '{{recipient_name}}: {{cookbook_id}}',
          },
        })
      ).statusCode,
      204,
    );
    const messages: Mail[] = [];
    capture(context, messages);
    try {
      const item: Fixture = await fixture();
      assert.equal(
        (await remove(item, { ...(await payload(item)), userReason: ' Public {{reason}}. ' }))
          .statusCode,
        204,
      );
      assert.equal(messages[0]!.subject, 'Gelöscht: Test tenant');
      assert.ok(messages[0]!.text.endsWith('\n\nPublic {{reason}}.'));
      assert.ok(!messages[0]!.text.includes('Internal investigation details'));
      const next: Fixture = await fixture();
      assert.equal((await remove(next, await payload(next))).statusCode, 204);
      assert.ok(!messages[1]!.text.includes('{{'));
      assert.ok(!messages[1]!.text.endsWith('\n\n'));
    } finally {
      assert.equal((await api.inject({ method: 'DELETE', url, headers })).statusCode, 204);
    }
  });

  test(`${kind} deletion survives SMTP failure or missing configuration`, async (context: TestContext): Promise<void> => {
    context.mock.method(nodemailer, 'createTransport', (): object => ({
      sendMail: async (): Promise<never> => {
        throw new Error('Private transport failure');
      },
    }));
    const item: Fixture = await fixture();
    assert.equal((await remove(item, await payload(item))).statusCode, 204);
    assert.equal(await exists(item), false);
    context.mock.restoreAll();
    const messages: Mail[] = [];
    capture(context, messages);
    await db.pool.query('DELETE FROM instance_mail_settings');
    try {
      const next: Fixture = await fixture();
      assert.equal((await remove(next, await payload(next))).statusCode, 204);
      assert.equal(await exists(next), false);
      assert.equal(messages.length, 0);
    } finally {
      await smtp();
    }
  });

  test(`${kind} deletion uses the pre-delete owner, tolerates unavailable owners and emails disabled owners`, async (context: TestContext): Promise<void> => {
    const messages: Mail[] = [];
    capture(context, messages);
    for (const unavailable of ['unclaimed', 'deleted', 'disabled']) {
      const item: Fixture = await fixture();
      if (unavailable === 'unclaimed')
        await db.pool.query('UPDATE tenant SET owner_principal_id=NULL WHERE id=$1', [
          item.tenant.id,
        ]);
      else
        await db.pool.query(
          `UPDATE user_account SET ${unavailable === 'deleted' ? 'deleted_at' : 'disabled_at'}=now() WHERE id=$1`,
          [owner.userId],
        );
      try {
        assert.equal((await remove(item, await payload(item))).statusCode, 204);
        assert.equal(await exists(item), false);
      } finally {
        await db.pool.query(
          'UPDATE user_account SET disabled_at=NULL,deleted_at=NULL WHERE id=$1',
          [owner.userId],
        );
      }
    }
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, owner.email);
  });
}

test('recipe trash retention cleanup does not send administrative deletion emails', async (context: TestContext): Promise<void> => {
  const item: Fixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  await db.pool.query('UPDATE tenant SET disabled_at=NULL,name_reset_required=false WHERE id=$1', [
    item.tenant.id,
  ]);
  await db.pool.query(
    "UPDATE recipe SET moderation_blocked_at=NULL,deleted_at=now()-interval '2 days',deletion_retention_days=1 WHERE id=$1",
    [item.recipe.id],
  );
  const directory: string = await mkdtemp(join(tmpdir(), 'shadowcook-deletion-email-'));
  try {
    await cleanupRecipeTrash(db.pool, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(
    (await db.pool.query('SELECT 1 FROM recipe WHERE id=$1', [item.recipe.id])).rowCount,
    0,
  );
  assert.equal(messages.length, 0);
});
