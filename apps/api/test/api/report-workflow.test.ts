import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { before, after, test, type TestContext } from 'node:test';
import nodemailer from 'nodemailer';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
import { createOwnedCookbook, type OwnedCookbook } from '../../src/cookbook/owned-cookbook.js';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import { pruneAdministrativeAudit } from '../../src/admin/audit-retention.js';
let db: DisposablePostgresDatabase;
let api: FastifyInstance;
let admin: TestUser;
let owner: TestUser;
let manager: TestUser;
let adminCookie: string;
let ownerCookie: string;
let managerCookie: string;
let ownerPublicId: string;
interface Book extends OwnedCookbook {
  publicId: string;
}
interface Context {
  available: boolean;
  inspectionPath: string | null;
  cookbookDisabled: boolean;
  recipeBlocked: boolean;
  identityResetRequired: boolean;
  recipients: { role: string; publicId: string }[];
}
async function call(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: object,
  cookie: string = adminCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({ method, url, ...(payload ? { payload } : {}), headers: { cookie } });
}
async function session(user: TestUser): Promise<string> {
  const result: BrowserSession = await issueSession(db.pool, user.userId);
  return `shadowcook_session=${result.token}`;
}
async function book(): Promise<Book> {
  const client: PoolClient = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result: OwnedCookbook = await createOwnedCookbook(
      client,
      owner.principalId,
      `Report workflow ${randomUUID()}`,
      100,
    );
    await client.query('COMMIT');
    const identity: QueryResult<{ public_id: string }> = await db.pool.query(
      'SELECT public_id FROM tenant WHERE id = $1',
      [result.id],
    );
    return { ...result, publicId: identity.rows[0]!.public_id };
  } finally {
    client.release();
  }
}
async function report(type: string, target: string): Promise<string> {
  const result: QueryResult<{ public_id: string }> = await db.pool.query(
    "INSERT INTO content_report (reporter_user_id, target_type, target_public_id, reason, description) VALUES ($1, $2, $3, 'OTHER', 'Private investigation details') RETURNING public_id",
    [owner.userId, type, target],
  );
  const id: string = result.rows[0]!.public_id;
  await db.pool.query('INSERT INTO content_report_notification (report_public_id) VALUES ($1)', [
    id,
  ]);
  return id;
}
async function event(target: Book, related: string | null = null): Promise<string> {
  const result: QueryResult<{ id: string }> = await db.pool.query(
    "INSERT INTO administrative_audit_event (actor_principal_id, action, target_type, target_public_id, cookbook_public_id, reason, request_id, related_report_public_id, outcome) VALUES ($1, 'ADMIN_COOKBOOK_MODERATED', 'COOKBOOK', $2, $2, 'Private rationale', 'workflow-test', $3, 'SUCCEEDED') RETURNING id",
    [admin.principalId, target.publicId, related],
  );
  return result.rows[0]!.id;
}
before(async (): Promise<void> => {
  db = await createDisposablePostgresDatabase();
  api = createTestApi(db.pool);
  admin = await createTestUser(db.pool, { email: 'workflow-admin@example.test' });
  owner = await createTestUser(db.pool, { email: 'workflow-owner@example.test' });
  manager = await createTestUser(db.pool, { email: 'workflow-manager@example.test' });
  for (const [user, role] of [
    [admin, 'administrator'],
    [manager, 'tenant-manager'],
  ] as [TestUser, string][])
    await db.pool.query(
      'INSERT INTO principal_instance_role SELECT $1, id FROM instance_role WHERE code = $2',
      [user.principalId, role],
    );
  adminCookie = await session(admin);
  ownerCookie = await session(owner);
  managerCookie = await session(manager);
  ownerPublicId = (
    await db.pool.query<{ public_id: string }>('SELECT public_id FROM user_account WHERE id = $1', [
      owner.userId,
    ])
  ).rows[0]!.public_id;
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
});

test('report metadata, history, linking and notices reject ordinary owners, tenant managers and bearer use', async (): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  const paths: [string, object | undefined][] = [
    [`/admin/reports/${id}`, undefined],
    [`/admin/reports/${id}/history`, { reason: 'Review' }],
    [
      `/admin/reports/${id}/events`,
      { reason: 'Review', confirmed: true, auditEventPublicId: randomUUID() },
    ],
    [`/admin/reports/${id}/notices`, { reason: 'Review' }],
  ];
  for (const cookie of [ownerCookie, managerCookie, ''])
    for (const [path, body] of paths)
      assert.equal(
        (await call(body ? 'POST' : 'GET', path, body, cookie)).statusCode,
        cookie ? 403 : 401,
      );
  // A valid human OAuth principal with administration permission is still not a browser session.
  await db.pool.query(
    "INSERT INTO oauth_client (client_id, client_name) VALUES ('workflow-client', 'Workflow test')",
  );
  const token: string = randomUUID().replaceAll('-', '');
  await db.pool.query(
    "INSERT INTO oauth_access_token (token_hash, principal_id, client_id, resource, scope, expires_at) VALUES ($1, $2, 'workflow-client', 'http://test-api.invalid', 'read', now() + interval '1 hour')",
    [createHash('sha256').update(token).digest(), admin.principalId],
  );
  for (const [path, body] of paths)
    assert.equal(
      (
        await api.inject({
          method: body ? 'POST' : 'GET',
          url: path,
          ...(body ? { payload: body } : {}),
          headers: { cookie: adminCookie, authorization: `Bearer ${token}` },
        })
      ).statusCode,
      403,
    );
});

test('private restricted recipe context links exact parent and revision without granting ordinary access', async (): Promise<void> => {
  const target: Book = await book();
  await db.pool.query(
    'UPDATE tenant SET disabled_at = now(), name_reset_required = true WHERE id = $1',
    [target.id],
  );
  const recipe: QueryResult<{ id: string; public_id: string }> = await db.pool.query(
    "INSERT INTO recipe (tenant_id, lineage_public_id, slug, moderation_blocked_at) VALUES ($1, $2, 'private-reported', now()) RETURNING id, public_id",
    [target.id, randomUUID()],
  );
  const revision: QueryResult<{ public_id: string }> = await db.pool.query(
    "INSERT INTO recipe_revision (recipe_id, revision_no, status, title, created_by_principal_id) VALUES ($1, 1, 'DRAFT', 'Private authored title', $2) RETURNING public_id",
    [recipe.rows[0]!.id, owner.principalId],
  );
  const id: string = await report('RECIPE', recipe.rows[0]!.public_id);
  const response: LightMyRequestResponse = await call('GET', `/admin/reports/${id}`);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const context: Context = response.json<{ context: Context }>().context;
  assert.equal(
    context.inspectionPath,
    `/admin/tenants/${target.publicId}/recipes/${recipe.rows[0]!.public_id}/revisions/${revision.rows[0]!.public_id}`,
  );
  assert.equal(context.cookbookDisabled, true);
  assert.equal(context.identityResetRequired, true);
  assert.equal(context.recipeBlocked, true);
  assert.ok(
    context.recipients.some(
      (recipient: { role: string; publicId: string }): boolean =>
        recipient.role === 'TARGET' && recipient.publicId === ownerPublicId,
    ),
  );
  assert.equal(response.body.includes('Private authored title'), false);
  await db.pool.query('UPDATE tenant SET name_reset_required = false WHERE id = $1', [target.id]);
});

test('closing or reopening a ticket audits decisions without blocking, deleting, transferring or notifying', async (): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  for (const result of ['BLOCKED', 'COOKBOOK_DELETED', 'UNFOUNDED']) {
    const response: LightMyRequestResponse = await call('PUT', `/admin/reports/${id}`, {
      status: 'CLOSED',
      result,
      resultNote: 'Private decision note',
      assignedAdminPublicId: null,
    });
    assert.equal(response.statusCode, 204, response.body);
    const tenant: QueryResult<{ disabled_at: Date | null; owner_principal_id: string }> =
      await db.pool.query('SELECT disabled_at, owner_principal_id FROM tenant WHERE id = $1', [
        target.id,
      ]);
    assert.equal(tenant.rows[0]!.disabled_at, null);
    assert.equal(tenant.rows[0]!.owner_principal_id, owner.principalId);
  }
  assert.equal(
    (
      await call('PUT', `/admin/reports/${id}`, {
        status: 'OPEN',
        result: null,
        resultNote: '',
        assignedAdminPublicId: null,
      })
    ).statusCode,
    204,
  );
  const history: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
    reason: 'Review decision history',
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().events.length, 4);
  assert.equal(history.json().notices.length, 0);
  assert.equal(history.body.includes('Private decision note'), false);
  assert.ok(
    history
      .json()
      .events.every((item: { action: string }): boolean => item.action === 'ADMIN_REPORT_UPDATED'),
  );
});

test('history includes correlated enforcement, scoped association is idempotent and foreign events are rejected', async (): Promise<void> => {
  const target: Book = await book();
  const other: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  const auto: string = await event(target, id);
  const manual: string = await event(target);
  const foreign: string = await event(other);
  for (const field of [
    { reason: '' },
    { reason: 'Review', page: 0 },
    { reason: 'Review', page: 1.5 },
    { reason: 'Review', forgedActor: admin.principalId },
  ])
    assert.equal((await call('POST', `/admin/reports/${id}/history`, field)).statusCode, 400);
  assert.equal(
    (
      await call('POST', `/admin/reports/${id}/events`, {
        reason: 'Correlate',
        confirmed: true,
        auditEventPublicId: foreign,
      })
    ).statusCode,
    404,
  );
  for (let attempt: number = 0; attempt < 2; attempt++)
    assert.equal(
      (
        await call('POST', `/admin/reports/${id}/events`, {
          reason: 'Correlate',
          confirmed: true,
          auditEventPublicId: manual,
        })
      ).statusCode,
      204,
    );
  assert.equal(
    (
      await db.pool.query(
        'SELECT 1 FROM administrative_report_event WHERE report_public_id = $1 AND event_id = $2',
        [id, manual],
      )
    ).rowCount,
    1,
  );
  const history: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
    reason: 'Recheck',
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.ok(
    history
      .json()
      .events.find((item: { publicId: string }): boolean => item.publicId === auto)
      .recheckPath?.includes(target.publicId),
  );
  assert.ok(
    history.json().events.some((item: { publicId: string }): boolean => item.publicId === auto),
  );
  assert.ok(
    history.json().events.some((item: { publicId: string }): boolean => item.publicId === manual),
  );
  await db.pool.query('DELETE FROM tenant WHERE id = $1', [target.id]);
  assert.equal((await call('GET', `/admin/reports/${id}`)).json().context.available, false);
  assert.equal((await call('GET', `/admin/reports/${id}`)).json().context.inspectionPath, null);
  const deletedHistory: LightMyRequestResponse = await call(
    'POST',
    `/admin/reports/${id}/history`,
    { reason: 'Deleted target review' },
  );
  assert.equal(deletedHistory.json().totalEvents, history.json().totalEvents);
  assert.ok(
    deletedHistory
      .json()
      .events.every((item: { recheckPath: string | null }): boolean => item.recheckPath === null),
  );
});

test('history pagination is stable across its own audited reads and has no event overlap', async (): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  for (let index: number = 0; index < 28; index++) await event(target, id);
  const first: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
    reason: 'Review page one',
    page: 1,
  });
  const second: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
    reason: 'Review page two',
    page: 2,
  });
  assert.equal(first.json().events.length, 25);
  assert.equal(second.json().events.length, 3);
  assert.equal(second.json().totalEvents, 28);
  const ids: Set<string> = new Set(
    first.json().events.map((row: { publicId: string }): string => row.publicId),
  );
  assert.ok(
    second.json().events.every((row: { publicId: string }): boolean => !ids.has(row.publicId)),
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT 1 FROM administrative_audit_event WHERE related_report_public_id = $1 AND action = 'ADMIN_REPORT_HISTORY_VIEWED'",
        [id],
      )
    ).rowCount,
    2,
  );
});

test('public notices verify recipient scope and send only explicit public content after commit', async (context: TestContext): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  const input: object = {
    reason: 'Confidential investigation rationale',
    confirmed: true,
    recipientRole: 'TARGET',
    expectedRecipientPublicId: ownerPublicId,
    message: 'We reviewed the reported cookbook. No action was warranted.',
    reviewInstructions: 'Request a second review at support@example.test.',
  };

  const adminPublicId: string = (
    await db.pool.query<{ public_id: string }>('SELECT public_id FROM user_account WHERE id = $1', [
      admin.userId,
    ])
  ).rows[0]!.public_id;
  const transferred: LightMyRequestResponse = await call(
    'POST',
    `/admin/tenants/${target.publicId}/ownership-transfer`,
    {
      reason: 'Recipient changed during review',
      confirmed: true,
      recipientPublicId: adminPublicId,
      expectedOwnerPublicId: ownerPublicId,
      formerOwnerRole: 'REMOVE',
    },
  );
  assert.equal(transferred.statusCode, 200, transferred.body);
  assert.equal((await call('POST', `/admin/reports/${id}/notices`, input)).statusCode, 409);
  const restored: LightMyRequestResponse = await call(
    'POST',
    `/admin/tenants/${target.publicId}/ownership-transfer`,
    {
      reason: 'Restore fixture ownership',
      confirmed: true,
      recipientPublicId: ownerPublicId,
      expectedOwnerPublicId: adminPublicId,
      formerOwnerRole: 'REMOVE',
    },
  );
  assert.equal(restored.statusCode, 200, restored.body);
  await db.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id) VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Test', $1) ON CONFLICT (singleton) DO NOTHING",
    [admin.principalId],
  );
  const messages: string[] = [];
  let fail: boolean = false;
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: { to: string; text: string }): Promise<void> => {
      assert.equal(
        (
          await db.pool.query(
            'SELECT 1 FROM administrative_report_notice WHERE report_public_id = $1',
            [id],
          )
        ).rowCount! > 0,
        true,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT 1 FROM administrative_audit_event WHERE related_report_public_id = $1 AND action = 'ADMIN_REPORT_NOTICE_CREATED'",
            [id],
          )
        ).rowCount! > 0,
        true,
      );
      if (fail) throw new Error('Private SMTP diagnostics');
      messages.push(mail.text);
      assert.equal(mail.to, owner.email);
    },
  }));

  assert.equal(
    (
      await call('POST', `/admin/reports/${id}/notices`, {
        ...input,
        expectedRecipientPublicId: randomUUID(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call('POST', `/admin/reports/${id}/notices`, { ...input, reviewInstructions: '' }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call('POST', `/admin/reports/${id}/notices`, { ...input, recipientRole: ['TARGET'] }))
      .statusCode,
    400,
  );
  const sent: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/notices`, input);
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().deliveryStatus, 'SENT');
  assert.equal(messages.length, 1);
  assert.ok(messages[0]!.includes('support@example.test'));
  assert.equal(messages[0]!.includes('Confidential investigation rationale'), false);
  assert.equal(messages[0]!.includes('Private investigation details'), false);
  fail = true;
  const failed: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/notices`, input);
  assert.equal(failed.statusCode, 200, failed.body);
  assert.equal(failed.json().deliveryStatus, 'FAILED');
  const history: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
    reason: 'Check delivery',
  });
  assert.deepEqual(
    history
      .json()
      .notices.map((row: { deliveryStatus: string }): string => row.deliveryStatus)
      .sort(),
    ['FAILED', 'SENT'],
  );
  assert.equal(
    (await db.pool.query('SELECT status FROM content_report WHERE public_id = $1', [id])).rows[0]
      .status,
    'OPEN',
  );
});

test('audit failure rolls back report decision, event association and notice creation before mail', async (): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  const existing: string = await event(target);
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_workflow_test CHECK (action NOT IN ('ADMIN_REPORT_UPDATED', 'ADMIN_REPORT_NOTICE_CREATED', 'ADMIN_REPORT_EVENT_LINKED', 'ADMIN_REPORT_HISTORY_VIEWED')) NOT VALID",
  );
  try {
    assert.equal(
      (
        await call('PUT', `/admin/reports/${id}`, {
          status: 'CLOSED',
          result: 'BLOCKED',
          resultNote: 'Review',
          assignedAdminPublicId: null,
        })
      ).statusCode,
      500,
    );
    assert.equal(
      (
        await call('POST', `/admin/reports/${id}/events`, {
          reason: 'Review',
          confirmed: true,
          auditEventPublicId: existing,
        })
      ).statusCode,
      500,
    );
    assert.equal(
      (
        await call('POST', `/admin/reports/${id}/notices`, {
          reason: 'Review',
          confirmed: true,
          recipientRole: 'TARGET',
          expectedRecipientPublicId: ownerPublicId,
          message: 'Public message',
          reviewInstructions: 'Contact support@example.test',
        })
      ).statusCode,
      500,
    );
    const read: LightMyRequestResponse = await call('POST', `/admin/reports/${id}/history`, {
      reason: 'Review',
    });
    assert.equal(read.statusCode, 500);
    assert.equal('events' in read.json(), false);
    assert.equal(
      (await db.pool.query('SELECT status FROM content_report WHERE public_id = $1', [id])).rows[0]
        .status,
      'OPEN',
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT 1 FROM administrative_report_event WHERE report_public_id = $1',
          [id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT 1 FROM administrative_report_notice WHERE report_public_id = $1',
          [id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await db.pool.query(
      'ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_workflow_test',
    );
  }
});

test('recipe event association rejects another recipe even inside the same cookbook', async (): Promise<void> => {
  const target: Book = await book();
  const recipes: string[] = [];
  for (let index: number = 0; index < 2; index++) {
    const row: QueryResult<{ public_id: string }> = await db.pool.query(
      'INSERT INTO recipe (tenant_id, lineage_public_id, slug) VALUES ($1, $2, $3) RETURNING public_id',
      [target.id, randomUUID(), `scoped-${index}`],
    );
    recipes.push(row.rows[0]!.public_id);
  }
  const id: string = await report('RECIPE', recipes[0]!);
  const foreign: QueryResult<{ id: string }> = await db.pool.query(
    "INSERT INTO administrative_audit_event (actor_principal_id, action, target_type, target_public_id, cookbook_public_id, reason, request_id, outcome) VALUES ($1, 'ADMIN_RECIPE_MODERATED', 'RECIPE', $2, $3, 'Sibling scope', 'sibling', 'SUCCEEDED') RETURNING id",
    [admin.principalId, recipes[1], target.publicId],
  );
  assert.equal(
    (
      await call('POST', `/admin/reports/${id}/events`, {
        reason: 'Scope check',
        confirmed: true,
        auditEventPublicId: foreign.rows[0]!.id,
      })
    ).statusCode,
    404,
  );
  const parentEvent: string = await event(target);
  assert.equal(
    (
      await call('POST', `/admin/reports/${id}/events`, {
        reason: 'Parent restriction affected this recipe',
        confirmed: true,
        auditEventPublicId: parentEvent,
      })
    ).statusCode,
    204,
  );
});

test('notice content expires with audit retention and event associations follow audit pruning', async (): Promise<void> => {
  const target: Book = await book();
  const id: string = await report('COOKBOOK', target.publicId);
  const existing: string = await event(target);
  await db.pool.query('INSERT INTO administrative_report_event VALUES ($1, $2)', [id, existing]);
  await db.pool.query(
    "UPDATE administrative_audit_event SET created_at = now() - interval '400 days' WHERE id = $1",
    [existing],
  );
  await db.pool.query(
    "INSERT INTO administrative_report_notice (report_public_id, recipient_user_id, recipient_role, message, review_instructions, created_at) VALUES ($1, $2, 'REPORTER', 'Old public notice', 'support@example.test', now() - interval '400 days')",
    [id, owner.userId],
  );
  assert.ok((await pruneAdministrativeAudit(db.pool)) > 0);
  assert.equal(
    (
      await db.pool.query('SELECT 1 FROM administrative_report_event WHERE event_id = $1', [
        existing,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.pool.query(
        'SELECT 1 FROM administrative_report_notice WHERE report_public_id = $1',
        [id],
      )
    ).rowCount,
    0,
  );
  assert.equal((await call('GET', `/admin/reports/${id}`)).statusCode, 200);
});
