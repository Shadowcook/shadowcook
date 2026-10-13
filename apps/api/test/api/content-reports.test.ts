import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test, type TestContext } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import { hashSessionToken } from '../../src/auth/session.js';
import { deliverReportNotifications } from '../../src/reports/notifications.js';
import { createTestApi } from '../helpers/api.js';
import {
  assignTenantRole,
  createTestUser,
  type TestUser,
  type TestTenant,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface Ticket {
  publicId: string;
  status: string;
  result: string | null;
  assignedAdminPublicId: string | null;
  description: string;
  targetName: string | null;
  targetUrl: string | null;
  notificationSentAt: string | null;
}
let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let member: TestUser;
let administrator: TestUser;
let outsider: TestUser;
let tenant: TestTenant;
let recipeId: string;
let recipePublicId: string;
let memberPublicId: string;
let adminPublicId: string;
let adminCookie: string;
let memberCookie: string;
let outsiderCookie: string;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  member = await createTestUser(database.pool, { email: 'reporter@example.test' });
  administrator = await createTestUser(database.pool, { email: 'reports-admin@example.test' });
  outsider = await createTestUser(database.pool, { email: 'reports-outsider@example.test' });
  tenant = await assignTenantRole(database.pool, member.principalId, 'reports-test', [
    'recipe:read',
    'recipe:visibility-update',
  ]);
  await database.pool.query("UPDATE tenant_role SET name = 'Owner' WHERE tenant_id = $1", [
    tenant.id,
  ]);
  await database.pool.query(
    "INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = 'administrator'",
    [administrator.principalId],
  );
  memberPublicId = await accountPublicId(member);
  adminPublicId = await accountPublicId(administrator);
  memberCookie = await session(member);
  adminCookie = await session(administrator);
  outsiderCookie = await session(outsider);
  const recipe: QueryResult<{ id: string; public_id: string }> = await database.pool.query(
    "INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, $2, 'reported-recipe') RETURNING id, public_id",
    [tenant.id, randomUUID()],
  );
  recipeId = recipe.rows[0]!.id;
  recipePublicId = recipe.rows[0]!.public_id;
  const revision: QueryResult<{ id: string }> = await database.pool.query(
    "INSERT INTO recipe_revision (recipe_id, revision_no, status, title, created_by_principal_id) VALUES ($1, 1, 'DRAFT', 'Reported recipe', $2) RETURNING id",
    [recipeId, member.principalId],
  );
  await database.pool.query(
    "WITH category AS (INSERT INTO category (tenant_id, name, slug) VALUES ($1, 'Report category', 'report-category') RETURNING id) INSERT INTO recipe_revision_category (recipe_revision_id, category_id) SELECT $2, id FROM category",
    [tenant.id, revision.rows[0]!.id],
  );
  await database.pool.query(
    "UPDATE recipe_revision SET status = 'PUBLISHED', published_at = now() WHERE id = $1",
    [revision.rows[0]!.id],
  );
  await database.pool.query('UPDATE recipe SET published_revision_id = $1 WHERE id = $2', [
    revision.rows[0]!.id,
    recipeId,
  ]);
});
after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('reporting and ticket administration enforce authentication and instance permissions', async (): Promise<void> => {
  for (const url of [
    '/reports/users?tenantSlug=reports-test',
    '/admin/reports',
    '/admin/report-settings',
    `/admin/reports/${randomUUID()}`,
  ]) {
    assert.equal((await api.inject({ method: 'GET', url })).statusCode, 401);
  }
  assert.equal((await submit('RECIPE', recipePublicId)).statusCode, 401);
  for (const url of [
    '/admin/reports',
    '/admin/report-settings',
    `/admin/reports/${randomUUID()}`,
  ]) {
    assert.equal(
      (await api.inject({ method: 'GET', url, headers: { cookie: memberCookie } })).statusCode,
      403,
    );
  }
  const restricted: TestUser = await createTestUser(database.pool, {
    email: 'restricted-reporter@example.test',
    passwordChangeRequired: true,
  });
  assert.equal((await submit('RECIPE', recipePublicId, await session(restricted))).statusCode, 403);
  await database.pool.query('UPDATE user_account SET disabled_at = now() WHERE id = $1', [
    restricted.userId,
  ]);
  assert.equal((await submit('RECIPE', recipePublicId, await session(restricted))).statusCode, 401);
});

test('reasons, descriptions, target identifiers, and filters are validated', async (): Promise<void> => {
  for (const override of [
    { reason: '' },
    { reason: 'UNKNOWN' },
    { description: '' },
    { description: ' \n\t ' },
    { description: 'x'.repeat(5001) },
    { targetType: ['RECIPE'] },
    { targetPublicId: 'bad-uuid' },
    { reporter_user_id: administrator.userId },
  ]) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/reports',
      headers: { cookie: memberCookie },
      payload: {
        targetType: 'RECIPE',
        targetPublicId: recipePublicId,
        reason: 'ILLEGAL_CONTENT',
        description: 'Test',
        ...override,
      },
    });
    assert.equal(response.statusCode, 400);
  }
  for (const query of ['status=UNKNOWN', 'page=0', 'page=1.2', 'page=NaN']) {
    assert.equal(
      (
        await api.inject({
          method: 'GET',
          url: `/admin/reports?${query}`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal((await submit('RECIPE', randomUUID(), memberCookie)).statusCode, 404);
});

test('recipes, cookbooks, and visible users create open unassigned tickets without SMTP', async (): Promise<void> => {
  for (const [targetType, targetPublicId] of [
    ['RECIPE', recipePublicId],
    ['COOKBOOK', tenant.publicId],
    ['USER', memberPublicId],
  ]) {
    const response: LightMyRequestResponse = await submit(
      targetType!,
      targetPublicId!,
      outsiderCookie,
    );
    assert.equal(response.statusCode, 201, response.body);
    const publicId: string = response.json<{ publicId: string }>().publicId;
    const ticket: Ticket = await readTicket(publicId);
    assert.equal(ticket.status, 'OPEN');
    assert.equal(ticket.result, null);
    assert.equal(ticket.assignedAdminPublicId, null);
    assert.equal(ticket.description, 'Unangemessener Inhalt 日本語');
    assert.equal(ticket.notificationSentAt, null);
    if (targetType === 'USER')
      assert.equal(ticket.targetUrl, `/admin/users#user-${memberPublicId}`);
    const outbox: QueryResult = await database.pool.query(
      'SELECT 1 FROM content_report_notification WHERE report_public_id = $1',
      [publicId],
    );
    assert.equal(outbox.rowCount, 1);
  }
  const users: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/reports/users?tenantSlug=reports-test',
    headers: { cookie: outsiderCookie },
  });
  assert.deepEqual(users.json(), {
    users: [{ publicId: memberPublicId, displayName: 'Test user' }],
  });
  assert.equal((await submit('USER', adminPublicId, outsiderCookie)).statusCode, 404);
});

test('private content stays inaccessible; valid recipe share tokens permit reporting', async (): Promise<void> => {
  await database.pool.query("UPDATE recipe SET visibility_override = 'PRIVATE' WHERE id = $1", [
    recipeId,
  ]);
  try {
    assert.equal((await submit('RECIPE', recipePublicId, outsiderCookie)).statusCode, 404);
    assert.equal((await submit('COOKBOOK', tenant.publicId, outsiderCookie)).statusCode, 404);
    assert.equal((await submit('USER', memberPublicId, outsiderCookie)).statusCode, 404);
    const hidden: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/reports/users?tenantSlug=reports-test',
      headers: { cookie: outsiderCookie },
    });
    assert.deepEqual(hidden.json(), { users: [] });
    assert.equal((await submit('RECIPE', recipePublicId, memberCookie)).statusCode, 201);
    const token: string = 'private-report-share';
    await database.pool.query(
      'INSERT INTO recipe_share_link (recipe_id, token, token_hash) VALUES ($1, $2, $3)',
      [recipeId, token, createHash('sha256').update(token).digest()],
    );
    const shared: LightMyRequestResponse = await submit('RECIPE', recipePublicId, outsiderCookie, {
      shareToken: token,
    });
    assert.equal(shared.statusCode, 201, shared.body);
    await database.pool.query('UPDATE recipe_share_link SET revoked_at = now() WHERE token = $1', [
      token,
    ]);
    assert.equal(
      (await submit('RECIPE', recipePublicId, outsiderCookie, { shareToken: token })).statusCode,
      404,
    );
  } finally {
    await database.pool.query('UPDATE recipe SET visibility_override = NULL WHERE id = $1', [
      recipeId,
    ]);
  }
});

test('tickets support administrator assignment, investigation, closure, filtering, and reopening', async (): Promise<void> => {
  const created: LightMyRequestResponse = await submit('COOKBOOK', tenant.publicId, memberCookie);
  const id: string = created.json<{ publicId: string }>().publicId;
  const input: {
    status: string;
    result: string | null;
    resultNote: string;
    assignedAdminPublicId: string | null;
  } = {
    status: 'UNDER_INVESTIGATION',
    result: null,
    resultNote: 'Investigating',
    assignedAdminPublicId: adminPublicId,
  };
  assert.equal((await updateTicket(id, input, memberCookie)).statusCode, 403);
  assert.equal((await updateTicket(id, input)).statusCode, 204);
  assert.equal((await readTicket(id)).assignedAdminPublicId, adminPublicId);
  assert.equal(
    (await updateTicket(id, { ...input, assignedAdminPublicId: memberPublicId })).statusCode,
    400,
  );
  assert.equal((await updateTicket(id, { ...input, status: 'CLOSED' })).statusCode, 400);
  assert.equal((await updateTicket(id, { ...input, result: 'UNFOUNDED' })).statusCode, 400);
  assert.equal(
    (
      await updateTicket(id, {
        ...input,
        status: 'CLOSED',
        result: 'UNFOUNDED',
        resultNote: 'Reviewed the original language.',
      })
    ).statusCode,
    204,
  );
  const closed: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/reports?status=CLOSED',
    headers: { cookie: adminCookie },
  });
  assert.deepEqual(
    closed.json<{ reports: Ticket[] }>().reports.map((ticket: Ticket): string => ticket.publicId),
    [id],
  );
  assert.equal((await readTicket(id)).result, 'UNFOUNDED');
  assert.equal(
    (await updateTicket(id, { ...input, status: 'OPEN', assignedAdminPublicId: null })).statusCode,
    204,
  );
  assert.equal((await readTicket(id)).assignedAdminPublicId, null);
});

test('report settings validate email and notifications survive SMTP failure and retry once', async (context: TestContext): Promise<void> => {
  const settings: { recipientEmail: string | null } = { recipientEmail: 'moderation@example.test' };
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url: '/admin/report-settings',
        headers: { cookie: memberCookie },
        payload: settings,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url: '/admin/report-settings',
        headers: { cookie: adminCookie },
        payload: { recipientEmail: 'bad-address' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await api.inject({
        method: 'PUT',
        url: '/admin/report-settings',
        headers: { cookie: adminCookie },
        payload: settings,
      })
    ).statusCode,
    204,
  );
  assert.deepEqual(
    (
      await api.inject({
        method: 'GET',
        url: '/admin/report-settings',
        headers: { cookie: adminCookie },
      })
    ).json(),
    settings,
  );
  await database.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id) VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)",
    [administrator.principalId],
  );
  let failing: boolean = true;
  const delivered: { to: string; subject: string; text: string }[] = [];
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: { to: string; subject: string; text: string }): Promise<void> => {
      if (failing) throw new Error('SMTP unavailable');
      delivered.push(mail);
    },
  }));
  const created: LightMyRequestResponse = await submit('RECIPE', recipePublicId, memberCookie);
  assert.equal(created.statusCode, 201);
  const id: string = created.json<{ publicId: string }>().publicId;
  assert.equal((await readTicket(id)).notificationSentAt, null);
  failing = false;
  await database.pool.query(
    'UPDATE content_report_notification SET next_attempt_at = now() WHERE report_public_id = $1',
    [id],
  );
  await Promise.all([
    deliverReportNotifications(database.pool, Buffer.alloc(32, 7), 'http://test-web.invalid', id),
    deliverReportNotifications(database.pool, Buffer.alloc(32, 7), 'http://test-web.invalid', id),
  ]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.to, settings.recipientEmail);
  assert.ok(delivered[0]?.text.includes(`/admin/reports/${id}`));
  assert.ok(delivered[0]?.text.includes('Unangemessener Inhalt 日本語'));
  assert.notEqual((await readTicket(id)).notificationSentAt, null);
  await deliverReportNotifications(
    database.pool,
    Buffer.alloc(32, 7),
    'http://test-web.invalid',
    id,
  );
  assert.equal(delivered.length, 1);
  const immediate: LightMyRequestResponse = await submit('RECIPE', recipePublicId, memberCookie);
  assert.equal(immediate.statusCode, 201);
  assert.equal(delivered.length, 2);
  await api.inject({
    method: 'PUT',
    url: '/admin/report-settings',
    headers: { cookie: adminCookie },
    payload: { recipientEmail: null },
  });
});

test('rate checks serialize concurrent reports and dashboard pagination returns fifty tickets', async (): Promise<void> => {
  const spammer: TestUser = await createTestUser(database.pool, {
    email: 'report-rate@example.test',
  });
  const cookie: string = await session(spammer);
  const responses: LightMyRequestResponse[] = await Promise.all(
    Array.from({ length: 12 }, (): Promise<LightMyRequestResponse> =>
      submit('RECIPE', recipePublicId, cookie),
    ),
  );
  assert.equal(
    responses.filter((response: LightMyRequestResponse): boolean => response.statusCode === 201)
      .length,
    10,
  );
  assert.equal(
    responses.filter((response: LightMyRequestResponse): boolean => response.statusCode === 429)
      .length,
    2,
  );
  await database.pool.query(
    "WITH reports AS (INSERT INTO content_report (reporter_user_id, target_type, target_public_id, reason, description) SELECT $1, 'RECIPE', $2, 'OTHER', 'Pagination fixture' FROM generate_series(1, 55) RETURNING public_id) INSERT INTO content_report_notification (report_public_id) SELECT public_id FROM reports",
    [spammer.userId, recipePublicId],
  );
  const first: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/reports',
    headers: { cookie: adminCookie },
  });
  const second: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/reports?page=2',
    headers: { cookie: adminCookie },
  });
  assert.equal(first.json<{ reports: Ticket[] }>().reports.length, 50);
  assert.ok(second.json<{ reports: Ticket[] }>().reports.length > 0);
  const firstIds: Set<string> = new Set(
    first.json<{ reports: Ticket[] }>().reports.map((ticket: Ticket): string => ticket.publicId),
  );
  assert.ok(
    second
      .json<{ reports: Ticket[] }>()
      .reports.every((ticket: Ticket): boolean => !firstIds.has(ticket.publicId)),
  );
});

test('tickets remain available after recipe or cookbook deletion', async (): Promise<void> => {
  const created: LightMyRequestResponse = await submit('COOKBOOK', tenant.publicId, memberCookie);
  assert.equal(created.statusCode, 201);
  const id: string = created.json<{ publicId: string }>().publicId;
  await database.pool.query('DELETE FROM tenant WHERE id = $1', [tenant.id]);
  const ticket: Ticket = await readTicket(id);
  assert.equal(ticket.targetName, null);
  assert.equal(ticket.targetUrl, null);
  assert.equal(ticket.description, 'Unangemessener Inhalt 日本語');
});

async function submit(
  targetType: string,
  targetPublicId: string,
  cookie?: string,
  extra: Record<string, unknown> = {},
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/reports',
    headers: cookie === undefined ? {} : { cookie },
    payload: {
      targetType,
      targetPublicId,
      reason: 'ILLEGAL_CONTENT',
      description: '  Unangemessener Inhalt 日本語  ',
      ...extra,
    },
  });
}
async function readTicket(id: string): Promise<Ticket> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/admin/reports/${id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ report: Ticket }>().report;
}
async function updateTicket(
  id: string,
  input: object,
  cookie: string = adminCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'PUT',
    url: `/admin/reports/${id}`,
    headers: { cookie },
    payload: input,
  });
}
async function accountPublicId(user: TestUser): Promise<string> {
  const result: QueryResult<{ public_id: string }> = await database.pool.query(
    'SELECT public_id FROM user_account WHERE id = $1',
    [user.userId],
  );
  return result.rows[0]!.public_id;
}
async function session(user: TestUser): Promise<string> {
  const token: string = randomUUID();
  await database.pool.query(
    "INSERT INTO user_session (user_account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [user.userId, hashSessionToken(token)],
  );
  return `shadowcook_session=${token}`;
}
