import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test, type TestContext } from 'node:test';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
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

interface RecipeFixture {
  tenant: TestTenant;
  id: string;
  publicId: string;
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

async function cookie(user: TestUser): Promise<string> {
  const session: BrowserSession = await issueSession(db.pool, user.userId);
  return `shadowcook_session=${session.token}`;
}
async function fixture(): Promise<RecipeFixture> {
  const tenant: TestTenant = await createTestTenant(db.pool, `notice-${randomUUID()}`);
  await db.pool.query('INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)', [
    tenant.id,
    owner.principalId,
  ]);
  await db.pool.query('UPDATE tenant SET owner_principal_id=$1 WHERE id=$2', [
    owner.principalId,
    tenant.id,
  ]);
  const result: QueryResult<{ id: string; public_id: string }> = await db.pool.query(
    "INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, gen_random_uuid(), 'suppe') RETURNING id, public_id",
    [tenant.id],
  );
  const recipe: { id: string; public_id: string } = result.rows[0]!;
  await db.pool.query(
    "INSERT INTO recipe_revision (recipe_id, revision_no, status, title, created_by_principal_id) VALUES ($1, 1, 'DRAFT', 'Kürbissuppe', $2)",
    [recipe.id, admin.principalId],
  );
  return { tenant, id: recipe.id, publicId: recipe.public_id };
}
async function moderate(
  recipe: RecipeFixture,
  overrides: object = {},
  auth: string = adminCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: `/admin/tenants/${recipe.tenant.publicId}/recipes/${recipe.publicId}/moderation`,
    headers: { cookie: auth },
    payload: {
      blocked: true,
      confirmed: true,
      reason: 'Private investigation details',
      userReason: '  Please remove the prohibited advertising.  ',
      ...overrides,
    },
  });
}
async function moderateCookbook(
  tenant: TestTenant,
  overrides: object = {},
  auth: string = adminCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenant.publicId}`,
    headers: { cookie: auth },
    payload: {
      disabled: true,
      confirmed: true,
      reason: 'Private investigation details',
      userReason: '  Please remove the prohibited advertising.  ',
      ...overrides,
    },
  });
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
  admin = await createTestUser(db.pool, { email: 'restriction-admin@example.test' });
  owner = await createTestUser(db.pool, { email: 'restriction-owner@example.test' });
  const manager: TestUser = await createTestUser(db.pool, {
    email: 'restriction-manager@example.test',
  });
  for (const [user, role] of [
    [admin, 'administrator'],
    [manager, 'tenant-manager'],
  ] as [TestUser, string][])
    await db.pool.query(
      'INSERT INTO principal_instance_role SELECT $1, id FROM instance_role WHERE code=$2',
      [user.principalId, role],
    );
  adminCookie = await cookie(admin);
  ownerCookie = await cookie(owner);
  managerCookie = await cookie(manager);
  await db.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host,smtp_port,transport_security,from_email,from_name,updated_by_principal_id) VALUES ('smtp.invalid',587,'STARTTLS','noreply@example.test','Shadowcook',$1)",
    [admin.principalId],
  );
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
});

test('new recipe restrictions notify the canonical owner after commit without leaking private reasons', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (message: Mail): Promise<object> => {
      // A separate database connection must already observe the restriction and audit.
      assert.ok(
        (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
          .rows[0].moderation_blocked_at,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action='ADMIN_RECIPE_MODERATED'",
            [recipe.publicId],
          )
        ).rowCount,
        1,
      );
      messages.push(message);
      return {};
    },
  }));
  assert.equal((await moderate(recipe)).statusCode, 204);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.to, owner.email);
  assert.ok(messages[0]!.subject.includes('Kürbissuppe'));
  assert.ok(
    messages[0]!.text.includes(`http://test-web.invalid/${recipe.tenant.slug}/recipes/suppe`),
  );
  assert.ok(messages[0]!.text.includes(recipe.publicId));
  assert.ok(!messages[0]!.text.includes('Private investigation details'));
  assert.ok(messages[0]!.text.includes('Please remove the prohibited advertising.'));
  assert.ok(!messages[0]!.text.includes('  Please remove'));
  assert.equal((await moderate(recipe)).statusCode, 204);
  context.mock.restoreAll();
  capture(context, messages);
  assert.equal((await moderate(recipe, { blocked: false, userReason: undefined })).statusCode, 204);
  assert.equal(messages.length, 2);
  assert.equal(messages[1]!.subject, 'Recipe restriction lifted: Kürbissuppe');
});

test('concurrent duplicate restrictions send one email and a subsequent new restriction sends again', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  const responses: LightMyRequestResponse[] = await Promise.all([
    moderate(recipe),
    moderate(recipe),
  ]);
  assert.ok(
    responses.every((response: LightMyRequestResponse): boolean => response.statusCode === 204),
  );
  assert.equal(messages.length, 1);
  await moderate(recipe, { blocked: false });
  await moderate(recipe);
  assert.equal(messages.length, 3);
});

test('unauthorized, invalid, cross-cookbook and failed audit operations send no email', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  for (const auth of ['', ownerCookie, managerCookie])
    assert.ok([401, 403].includes((await moderate(recipe, {}, auth)).statusCode));
  assert.equal((await moderate(recipe, { reason: '' })).statusCode, 400);
  assert.equal((await moderate(recipe, { confirmed: false })).statusCode, 400);
  const other: RecipeFixture = await fixture();
  assert.equal((await moderate({ ...recipe, tenant: other.tenant })).statusCode, 404);
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_recipe_notice CHECK (action <> 'ADMIN_RECIPE_MODERATED') NOT VALID",
  );
  try {
    assert.equal((await moderate(recipe)).statusCode, 500);
    assert.equal(
      (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
        .rows[0].moderation_blocked_at,
      null,
    );
  } finally {
    await db.pool.query(
      'ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_recipe_notice',
    );
  }
  assert.equal(messages.length, 0);
});

test('SMTP rejection and unavailable owners do not undo restrictions; disabled owners still receive email', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (): Promise<never> => {
      throw new Error('SMTP rejected private recipient');
    },
  }));
  assert.equal((await moderate(recipe)).statusCode, 204);
  assert.ok(
    (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
      .rows[0].moderation_blocked_at,
  );
  const messages: Mail[] = [];
  context.mock.restoreAll();
  capture(context, messages);
  for (const unavailable of ['unclaimed', 'deleted', 'disabled']) {
    const next: RecipeFixture = await fixture();
    if (unavailable === 'unclaimed')
      await db.pool.query('UPDATE tenant SET owner_principal_id=NULL WHERE id=$1', [
        next.tenant.id,
      ]);
    else
      await db.pool.query(
        `UPDATE user_account SET ${unavailable === 'deleted' ? 'deleted_at' : 'disabled_at'}=now() WHERE id=$1`,
        [owner.userId],
      );
    try {
      assert.equal((await moderate(next)).statusCode, 204);
    } finally {
      await db.pool.query('UPDATE user_account SET deleted_at=NULL, disabled_at=NULL WHERE id=$1', [
        owner.userId,
      ]);
    }
  }
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.to, owner.email);
});

test('the restriction template is listed, customizable and resettable through existing admin APIs', async (context: TestContext): Promise<void> => {
  const headers: { cookie: string } = { cookie: adminCookie };
  const listing: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/email-templates',
    headers,
  });
  assert.equal(listing.statusCode, 200);
  assert.ok(
    listing
      .json()
      .templates.some((template: { key: string }): boolean => template.key === 'RECIPE_RESTRICTED'),
  );
  const url: string = '/admin/email-templates/RECIPE_RESTRICTED';
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url,
        headers,
        payload: { subject: '{{reason}}', body: 'Private {{description}}' },
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
          subject: 'Gesperrt: {{recipe_name}}',
          body: '{{recipient_name}}: {{recipe_id}} in {{cookbook_name}}. {{recipe_url}}\n{{user_reason}}',
        },
      })
    ).statusCode,
    204,
  );
  const messages: Mail[] = [];
  capture(context, messages);
  try {
    const recipe: RecipeFixture = await fixture();
    assert.equal((await moderate(recipe)).statusCode, 204);
    assert.equal(messages[0]!.subject, 'Gesperrt: Kürbissuppe');
    assert.ok(messages[0]!.text.includes(recipe.publicId));
    assert.ok(!messages[0]!.text.includes('{{'));
    assert.equal(messages[0]!.text.split('Please remove the prohibited advertising.').length, 2);
  } finally {
    assert.equal((await api.inject({ method: 'DELETE', url, headers })).statusCode, 204);
  }
});

test('missing SMTP configuration preserves the restriction without attempting transport', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  await db.pool.query('DELETE FROM instance_mail_settings');
  try {
    assert.equal((await moderate(recipe)).statusCode, 204);
    assert.ok(
      (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
        .rows[0].moderation_blocked_at,
    );
    assert.equal((await moderateCookbook(recipe.tenant)).statusCode, 204);
    assert.ok(
      (await db.pool.query('SELECT disabled_at FROM tenant WHERE id=$1', [recipe.tenant.id]))
        .rows[0].disabled_at,
    );
    assert.equal(messages.length, 0);
    assert.equal(
      (await moderate(recipe, { blocked: false, userReason: undefined })).statusCode,
      204,
    );
    assert.equal(
      (await moderateCookbook(recipe.tenant, { disabled: false, userReason: undefined }))
        .statusCode,
      204,
    );
    assert.equal(messages.length, 0);
  } finally {
    await db.pool.query(
      "INSERT INTO instance_mail_settings (smtp_host,smtp_port,transport_security,from_email,from_name,updated_by_principal_id) VALUES ('smtp.invalid',587,'STARTTLS','noreply@example.test','Shadowcook',$1)",
      [admin.principalId],
    );
  }
});

const liftedKinds: readonly ('recipe' | 'cookbook')[] = ['recipe', 'cookbook'];
for (const kind of liftedKinds) {
  const templateKey: string =
    kind === 'recipe' ? 'RECIPE_RESTRICTION_LIFTED' : 'COOKBOOK_RESTRICTION_LIFTED';
  const stateSql: string =
    kind === 'recipe'
      ? 'SELECT moderation_blocked_at AS restricted_at FROM recipe WHERE id=$1'
      : 'SELECT disabled_at AS restricted_at FROM tenant WHERE id=$1';
  async function restrictedFixture(): Promise<RecipeFixture> {
    const recipe: RecipeFixture = await fixture();
    await db.pool.query(
      'UPDATE tenant SET disabled_at=now(), name_reset_required=true WHERE id=$1',
      [recipe.tenant.id],
    );
    await db.pool.query(
      'UPDATE recipe SET moderation_blocked_at=now(), deleted_at=now(), deletion_retention_days=30 WHERE id=$1',
      [recipe.id],
    );
    return recipe;
  }
  async function lift(
    recipe: RecipeFixture,
    overrides: object = {},
    auth: string = adminCookie,
  ): Promise<LightMyRequestResponse> {
    return kind === 'recipe'
      ? moderate(recipe, { blocked: false, userReason: undefined, ...overrides }, auth)
      : moderateCookbook(
          recipe.tenant,
          { disabled: false, userReason: undefined, ...overrides },
          auth,
        );
  }
  test(`${kind} restriction lifting notifies after commit once, while preserving independent restrictions and trash`, async (context: TestContext): Promise<void> => {
    const recipe: RecipeFixture = await restrictedFixture();
    const messages: Mail[] = [];
    context.mock.method(nodemailer, 'createTransport', (): object => ({
      sendMail: async (message: Mail): Promise<object> => {
        assert.equal(
          (await db.pool.query(stateSql, [kind === 'recipe' ? recipe.id : recipe.tenant.id]))
            .rows[0].restricted_at,
          null,
        );
        assert.ok(
          (
            await db.pool.query(
              'SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action=$2',
              [
                kind === 'recipe' ? recipe.publicId : recipe.tenant.publicId,
                `ADMIN_${kind.toUpperCase()}_MODERATED`,
              ],
            )
          ).rowCount! >= 1,
        );
        messages.push(message);
        return {};
      },
    }));
    const responses: LightMyRequestResponse[] = await Promise.all([lift(recipe), lift(recipe)]);
    assert.ok(
      responses.every((response: LightMyRequestResponse): boolean => response.statusCode === 204),
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, owner.email);
    assert.equal(
      messages[0]!.subject,
      kind === 'recipe'
        ? 'Recipe restriction lifted: Kürbissuppe'
        : 'Cookbook restriction lifted: Test tenant',
    );
    assert.ok(
      messages[0]!.text.includes(kind === 'recipe' ? recipe.publicId : recipe.tenant.publicId),
    );
    assert.ok(!messages[0]!.text.includes('Private investigation details'));
    assert.ok(!messages[0]!.text.includes('Please remove'));
    assert.ok(!messages[0]!.text.includes('{{'));
    const remaining: QueryResult<{
      name_reset_required: boolean;
      disabled_at: Date | null;
      moderation_blocked_at: Date | null;
      deleted_at: Date | null;
    }> = await db.pool.query(
      'SELECT tenant.name_reset_required, tenant.disabled_at, recipe.moderation_blocked_at, recipe.deleted_at FROM tenant JOIN recipe ON recipe.tenant_id=tenant.id WHERE recipe.id=$1',
      [recipe.id],
    );
    assert.equal(remaining.rows[0]!.name_reset_required, true);
    assert.ok(remaining.rows[0]!.deleted_at);
    assert.ok(
      kind === 'recipe' ? remaining.rows[0]!.disabled_at : remaining.rows[0]!.moderation_blocked_at,
    );
  });

  test(`${kind} lifted template can be customized and includes an optional public explanation once`, async (context: TestContext): Promise<void> => {
    const recipe: RecipeFixture = await restrictedFixture();
    const headers: { cookie: string } = { cookie: adminCookie };
    const url: string = `/admin/email-templates/${templateKey}`;
    const listing: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/admin/email-templates',
      headers,
    });
    assert.ok(
      listing
        .json()
        .templates.some((template: { key: string }): boolean => template.key === templateKey),
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
            subject: 'Sperre aufgehoben: {{cookbook_name}}',
            body:
              kind === 'recipe'
                ? 'Hello {{recipient_name}}. {{recipe_url}}'
                : 'Hello {{recipient_name}}. {{cookbook_url}}',
          },
        })
      ).statusCode,
      204,
    );
    const messages: Mail[] = [];
    capture(context, messages);
    try {
      assert.equal(
        (await lift(recipe, { userReason: '  Review completed. Thank you.  ' })).statusCode,
        204,
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0]!.subject, 'Sperre aufgehoben: Test tenant');
      assert.ok(messages[0]!.text.endsWith('\n\nReview completed. Thank you.'));
      assert.ok(!messages[0]!.text.includes('Private investigation details'));
      assert.equal(messages[0]!.text.split('Review completed. Thank you.').length, 2);
    } finally {
      assert.equal((await api.inject({ method: 'DELETE', url, headers })).statusCode, 204);
    }
  });

  test(`${kind} failed or unauthorized lifting sends no mail, while SMTP failure preserves committed lifting`, async (context: TestContext): Promise<void> => {
    const recipe: RecipeFixture = await restrictedFixture();
    const messages: Mail[] = [];
    capture(context, messages);
    for (const auth of ['', ownerCookie, managerCookie])
      assert.ok([401, 403].includes((await lift(recipe, {}, auth)).statusCode));
    assert.equal((await lift(recipe, { confirmed: false })).statusCode, 400);
    await db.pool.query(
      `ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_lifting CHECK (action <> 'ADMIN_${kind.toUpperCase()}_MODERATED') NOT VALID`,
    );
    try {
      assert.equal((await lift(recipe)).statusCode, 500);
      assert.ok(
        (await db.pool.query(stateSql, [kind === 'recipe' ? recipe.id : recipe.tenant.id])).rows[0]
          .restricted_at,
      );
    } finally {
      await db.pool.query('ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_lifting');
    }
    assert.equal(messages.length, 0);
    context.mock.restoreAll();
    context.mock.method(nodemailer, 'createTransport', (): object => ({
      sendMail: async (): Promise<never> => {
        throw new Error('SMTP rejected private recipient');
      },
    }));
    assert.equal((await lift(recipe)).statusCode, 204);
    assert.equal(
      (await db.pool.query(stateSql, [kind === 'recipe' ? recipe.id : recipe.tenant.id])).rows[0]
        .restricted_at,
      null,
    );
  });

  test(`${kind} lifting tolerates missing owners and notifies deactivated owners`, async (context: TestContext): Promise<void> => {
    const messages: Mail[] = [];
    capture(context, messages);
    for (const unavailable of ['unclaimed', 'deleted', 'disabled']) {
      const recipe: RecipeFixture = await restrictedFixture();
      if (unavailable === 'unclaimed')
        await db.pool.query('UPDATE tenant SET owner_principal_id=NULL WHERE id=$1', [
          recipe.tenant.id,
        ]);
      else
        await db.pool.query(
          `UPDATE user_account SET ${unavailable === 'deleted' ? 'deleted_at' : 'disabled_at'}=now() WHERE id=$1`,
          [owner.userId],
        );
      try {
        assert.equal((await lift(recipe)).statusCode, 204);
        assert.equal(
          (await db.pool.query(stateSql, [kind === 'recipe' ? recipe.id : recipe.tenant.id]))
            .rows[0].restricted_at,
          null,
        );
      } finally {
        await db.pool.query(
          'UPDATE user_account SET deleted_at=NULL, disabled_at=NULL WHERE id=$1',
          [owner.userId],
        );
      }
    }
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, owner.email);
  });
}

test('recipes without revisions use their slug and cookbook restrictions send no recipe email', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  await db.pool.query('DELETE FROM recipe_revision WHERE recipe_id=$1', [recipe.id]);
  assert.equal((await moderate(recipe)).statusCode, 204);
  assert.equal(messages[0]!.subject, 'Recipe restricted: suppe');
  assert.equal(
    (
      await api.inject({
        method: 'PATCH',
        url: `/admin/tenants/${recipe.tenant.publicId}`,
        headers: { cookie: adminCookie },
        payload: {
          disabled: true,
          confirmed: true,
          reason: 'Cookbook restriction',
          userReason: 'Please remove advertising.',
        },
      })
    ).statusCode,
    204,
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[1]!.subject, 'Cookbook restricted: Test tenant');
  assert.ok(!messages[1]!.text.includes(recipe.publicId));
});

test('cookbook restrictions notify the canonical owner after commit, preserving private reasons and identity locks', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  await db.pool.query('UPDATE tenant SET name_reset_required=true WHERE id=$1', [recipe.tenant.id]);
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (message: Mail): Promise<object> => {
      const state: QueryResult<{ disabled_at: Date | null; name_reset_required: boolean }> =
        await db.pool.query('SELECT disabled_at, name_reset_required FROM tenant WHERE id=$1', [
          recipe.tenant.id,
        ]);
      assert.ok(state.rows[0]!.disabled_at);
      assert.equal(state.rows[0]!.name_reset_required, true);
      assert.equal(
        (
          await db.pool.query(
            "SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action='ADMIN_COOKBOOK_MODERATED'",
            [recipe.tenant.publicId],
          )
        ).rowCount,
        1,
      );
      messages.push(message);
      return {};
    },
  }));
  assert.equal((await moderateCookbook(recipe.tenant)).statusCode, 204);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.to, owner.email);
  assert.equal(messages[0]!.subject, 'Cookbook restricted: Test tenant');
  assert.ok(messages[0]!.text.includes(`http://test-web.invalid/${recipe.tenant.slug}`));
  assert.ok(messages[0]!.text.includes(recipe.tenant.publicId));
  assert.ok(!messages[0]!.text.includes('Private investigation details'));
  assert.ok(messages[0]!.text.includes('Please remove the prohibited advertising.'));
  assert.ok(!messages[0]!.text.includes('  Please remove'));
  assert.ok(!messages[0]!.text.includes(recipe.publicId));
});

test('concurrent duplicate cookbook restrictions send one email; unrestriction preserves the identity lock and notifies the owner', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  await db.pool.query('UPDATE tenant SET name_reset_required=true WHERE id=$1', [recipe.tenant.id]);
  const responses: LightMyRequestResponse[] = await Promise.all([
    moderateCookbook(recipe.tenant),
    moderateCookbook(recipe.tenant),
  ]);
  assert.ok(
    responses.every((response: LightMyRequestResponse): boolean => response.statusCode === 204),
  );
  assert.equal(messages.length, 1);
  assert.equal(
    (await moderateCookbook(recipe.tenant, { disabled: false, userReason: undefined })).statusCode,
    204,
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[1]!.subject, 'Cookbook restriction lifted: Test tenant');
  assert.equal(
    (await db.pool.query('SELECT name_reset_required FROM tenant WHERE id=$1', [recipe.tenant.id]))
      .rows[0].name_reset_required,
    true,
  );
  assert.equal((await moderateCookbook(recipe.tenant)).statusCode, 204);
  assert.equal(messages.length, 3);
});

test('denied, invalid and rolled-back cookbook moderation sends no email', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  for (const auth of ['', ownerCookie, managerCookie])
    assert.ok([401, 403].includes((await moderateCookbook(recipe.tenant, {}, auth)).statusCode));
  assert.equal((await moderateCookbook(recipe.tenant, { reason: '' })).statusCode, 400);
  assert.equal((await moderateCookbook(recipe.tenant, { confirmed: false })).statusCode, 400);
  assert.equal(
    (await moderateCookbook({ ...recipe.tenant, publicId: randomUUID() })).statusCode,
    404,
  );
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_cookbook_notice CHECK (action <> 'ADMIN_COOKBOOK_MODERATED') NOT VALID",
  );
  try {
    assert.equal((await moderateCookbook(recipe.tenant)).statusCode, 500);
    assert.equal(
      (await db.pool.query('SELECT disabled_at FROM tenant WHERE id=$1', [recipe.tenant.id]))
        .rows[0].disabled_at,
      null,
    );
  } finally {
    await db.pool.query(
      'ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_cookbook_notice',
    );
  }
  assert.equal(messages.length, 0);
});

test('cookbook notification failures and missing owners preserve restrictions; disabled owners receive mail', async (context: TestContext): Promise<void> => {
  const failed: RecipeFixture = await fixture();
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (): Promise<never> => {
      throw new Error('SMTP rejected private recipient');
    },
  }));
  assert.equal((await moderateCookbook(failed.tenant)).statusCode, 204);
  assert.ok(
    (await db.pool.query('SELECT disabled_at FROM tenant WHERE id=$1', [failed.tenant.id])).rows[0]
      .disabled_at,
  );
  context.mock.restoreAll();
  const messages: Mail[] = [];
  capture(context, messages);
  for (const unavailable of ['unclaimed', 'deleted', 'disabled']) {
    const next: RecipeFixture = await fixture();
    if (unavailable === 'unclaimed')
      await db.pool.query('UPDATE tenant SET owner_principal_id=NULL WHERE id=$1', [
        next.tenant.id,
      ]);
    else
      await db.pool.query(
        `UPDATE user_account SET ${unavailable === 'deleted' ? 'deleted_at' : 'disabled_at'}=now() WHERE id=$1`,
        [owner.userId],
      );
    try {
      assert.equal((await moderateCookbook(next.tenant)).statusCode, 204);
      assert.ok(
        (await db.pool.query('SELECT disabled_at FROM tenant WHERE id=$1', [next.tenant.id]))
          .rows[0].disabled_at,
      );
    } finally {
      await db.pool.query('UPDATE user_account SET deleted_at=NULL, disabled_at=NULL WHERE id=$1', [
        owner.userId,
      ]);
    }
  }
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.to, owner.email);
});

test('cookbook restriction templates support customization without private placeholders', async (context: TestContext): Promise<void> => {
  const headers: { cookie: string } = { cookie: adminCookie };
  const url: string = '/admin/email-templates/COOKBOOK_RESTRICTED';
  const listing: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/email-templates',
    headers,
  });
  assert.equal(listing.statusCode, 200);
  assert.ok(
    listing
      .json()
      .templates.some(
        (template: { key: string }): boolean => template.key === 'COOKBOOK_RESTRICTED',
      ),
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
          subject: 'Kochbuch gesperrt: {{cookbook_name}}',
          body: '{{recipient_name}}: {{cookbook_id}}. {{cookbook_url}}',
        },
      })
    ).statusCode,
    204,
  );
  const messages: Mail[] = [];
  capture(context, messages);
  try {
    const recipe: RecipeFixture = await fixture();
    assert.equal((await moderateCookbook(recipe.tenant)).statusCode, 204);
    assert.equal(messages[0]!.subject, 'Kochbuch gesperrt: Test tenant');
    assert.ok(messages[0]!.text.includes(recipe.tenant.publicId));
    assert.ok(!messages[0]!.text.includes('{{'));
    assert.equal(messages[0]!.text.split('Please remove the prohibited advertising.').length, 2);
  } finally {
    assert.equal((await api.inject({ method: 'DELETE', url, headers })).statusCode, 204);
  }
});

test('both restriction routes require a separate nonblank public reason and reject invalid values before changing state or sending mail', async (context: TestContext): Promise<void> => {
  const recipe: RecipeFixture = await fixture();
  const messages: Mail[] = [];
  capture(context, messages);
  for (const userReason of [undefined, null, false, 123, '', ' \n\t ', '😀'.repeat(2001)]) {
    assert.equal((await moderate(recipe, { userReason })).statusCode, 400);
    assert.equal((await moderateCookbook(recipe.tenant, { userReason })).statusCode, 400);
  }
  assert.equal(messages.length, 0);
  assert.equal(
    (await db.pool.query('SELECT moderation_blocked_at FROM recipe WHERE id=$1', [recipe.id]))
      .rows[0].moderation_blocked_at,
    null,
  );
  assert.equal(
    (await db.pool.query('SELECT disabled_at FROM tenant WHERE id=$1', [recipe.tenant.id])).rows[0]
      .disabled_at,
    null,
  );
  // An existing restriction can be lifted without a public email reason.
  assert.equal((await moderate(recipe, { userReason: '😀'.repeat(2000) })).statusCode, 204);
  assert.equal((await moderate(recipe, { blocked: false, userReason: undefined })).statusCode, 204);
  assert.equal(
    (await moderateCookbook(recipe.tenant, { userReason: '😀'.repeat(2000) })).statusCode,
    204,
  );
  assert.equal(
    (await moderateCookbook(recipe.tenant, { disabled: false, userReason: undefined })).statusCode,
    204,
  );
  assert.equal(messages.length, 4);
});
