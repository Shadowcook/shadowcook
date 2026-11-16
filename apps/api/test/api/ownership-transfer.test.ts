import nodemailer from 'nodemailer';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test, type TestContext } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import { createOwnedCookbook, type OwnedCookbook } from '../../src/cookbook/owned-cookbook.js';
import { pendingCookbookResets } from '../../src/account/cookbook-identity-routes.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
let db: DisposablePostgresDatabase;
let api: FastifyInstance;
let admin: TestUser;
let old: TestUser;
let next: TestUser;
let alternate: TestUser;
let cookie: string;
let oldCookie: string;
let managerCookie: string;
let oldPublic: string;
let nextPublic: string;
let alternatePublic: string;
interface Cookbook extends OwnedCookbook {
  publicId: string;
}
async function publicId(user: TestUser): Promise<string> {
  return (
    await db.pool.query<{ public_id: string }>('SELECT public_id FROM user_account WHERE id = $1', [
      user.userId,
    ])
  ).rows[0]!.public_id;
}
async function session(user: TestUser): Promise<string> {
  const issued: BrowserSession = await issueSession(db.pool, user.userId);
  return `shadowcook_session=${issued.token}`;
}
async function cookbook(): Promise<Cookbook> {
  const client: PoolClient = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const created: OwnedCookbook = await createOwnedCookbook(
      client,
      old.principalId,
      `Transfer ${randomUUID()}`,
      100,
    );
    await client.query('COMMIT');
    return {
      ...created,
      publicId: (
        await db.pool.query<{ public_id: string }>('SELECT public_id FROM tenant WHERE id = $1', [
          created.id,
        ])
      ).rows[0]!.public_id,
    };
  } finally {
    client.release();
  }
}
async function transfer(
  book: Cookbook,
  overrides: object = {},
  auth: string = cookie,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: `/admin/tenants/${book.publicId}/ownership-transfer`,
    headers: { cookie: auth },
    payload: {
      recipientPublicId: nextPublic,
      expectedOwnerPublicId: oldPublic,
      formerOwnerRole: 'REMOVE',
      confirmed: true,
      reason: 'Verified recovery request through independent contact',
      ...overrides,
    },
  });
}
before(async (): Promise<void> => {
  db = await createDisposablePostgresDatabase();
  api = createTestApi(db.pool);
  admin = await createTestUser(db.pool, { email: 'transfer-admin@example.test' });
  old = await createTestUser(db.pool, { email: 'transfer-old@example.test' });
  next = await createTestUser(db.pool, { email: 'transfer-next@example.test' });
  alternate = await createTestUser(db.pool, { email: 'transfer-alternate@example.test' });
  const manager: TestUser = await createTestUser(db.pool, {
    email: 'transfer-manager@example.test',
  });
  for (const [user, role] of [
    [admin, 'administrator'],
    [manager, 'tenant-manager'],
  ] as [TestUser, string][])
    await db.pool.query(
      'INSERT INTO principal_instance_role SELECT $1, id FROM instance_role WHERE code = $2',
      [user.principalId, role],
    );
  cookie = await session(admin);
  oldCookie = await session(old);
  managerCookie = await session(manager);
  oldPublic = await publicId(old);
  nextPublic = await publicId(next);
  alternatePublic = await publicId(alternate);
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
});

test('only justified, confirmed administrator-session transfers and candidate searches are permitted', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  for (const auth of ['', oldCookie, managerCookie]) {
    assert.ok([401, 403].includes((await transfer(book, {}, auth)).statusCode));
    const response: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: `/admin/tenants/${book.publicId}/ownership-candidates`,
      headers: { cookie: auth },
      payload: { reason: 'Review', query: 'transfer' },
    });
    assert.ok([401, 403].includes(response.statusCode));
  }
  for (const overrides of [
    { reason: '' },
    { confirmed: false },
    { recipientPublicId: oldPublic },
    { formerOwnerRole: 'Owner' },
    { recipientPublicId: randomUUID() },
  ])
    assert.equal((await transfer(book, overrides)).statusCode, 400);
  assert.equal((await transfer(book, { expectedOwnerPublicId: null })).statusCode, 409);
  const bearer: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/admin/tenants/${book.publicId}/ownership-transfer`,
    headers: { cookie, authorization: 'Bearer service-or-oauth' },
    payload: { reason: 'Review' },
  });
  assert.equal(bearer.statusCode, 403);
  const search: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/admin/tenants/${book.publicId}/ownership-candidates`,
    headers: { cookie },
    payload: { reason: 'Review', query: 'transfer' },
  });
  assert.equal(search.statusCode, 200);
  assert.ok(
    search
      .json()
      .users.some(
        (user: { publicId: string; email: string }): boolean =>
          user.publicId === nextPublic && user.email === next.email,
      ),
  );
});

test('remove, Viewer and Editor outcomes atomically replace membership roles and preserve restrictions and authorship', async (): Promise<void> => {
  for (const role of ['REMOVE', 'Viewer', 'Editor']) {
    const book: Cookbook = await cookbook();
    await db.pool.query(
      'UPDATE tenant SET disabled_at = now(), name_reset_required = true WHERE id = $1',
      [book.id],
    );
    await db.pool.query('INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1,$2)', [
      book.id,
      next.principalId,
    ]);
    await db.pool.query(
      "INSERT INTO tenant_membership_role SELECT $1,$2,id FROM tenant_role WHERE tenant_id=$1 AND name='Editor'",
      [book.id, next.principalId],
    );
    const recipe: QueryResult<{ id: string; public_id: string }> = await db.pool.query(
      "INSERT INTO recipe (tenant_id,lineage_public_id,slug) VALUES ($1,gen_random_uuid(),'untouched') RETURNING id, public_id",
      [book.id],
    );
    await db.pool.query(
      "INSERT INTO recipe_revision (recipe_id,revision_no,status,title,created_by_principal_id) VALUES ($1,1,'DRAFT','Original authored content',$2)",
      [recipe.rows[0]!.id, old.principalId],
    );
    const authored: QueryResult = await db.pool.query(
      'SELECT * FROM recipe_revision WHERE recipe_id=$1',
      [recipe.rows[0]!.id],
    );
    await db.pool.query(
      "WITH r AS (INSERT INTO tenant_role (tenant_id,name) VALUES ($1,'Legacy admin') RETURNING id), p AS (INSERT INTO tenant_role_permission SELECT id,'tenant:manage' FROM r) INSERT INTO tenant_membership_role SELECT $1,$2,id FROM r",
      [book.id, old.principalId],
    );
    const response: LightMyRequestResponse = await transfer(book, { formerOwnerRole: role });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().notifications.length, 2);
    assert.ok(
      response
        .json()
        .notifications.every((item: { status: string }): boolean => item.status === 'FAILED'),
    );
    const state: QueryResult = await db.pool.query(
      'SELECT owner_principal_id,disabled_at,name_reset_required FROM tenant WHERE id=$1',
      [book.id],
    );
    assert.equal(state.rows[0].owner_principal_id, next.principalId);
    assert.ok(state.rows[0].disabled_at);
    assert.equal(state.rows[0].name_reset_required, true);
    for (const [principal, expected] of [
      [old.principalId, role === 'REMOVE' ? [] : [role]],
      [next.principalId, ['Owner']],
    ] as [string, string[]][]) {
      const assigned: QueryResult<{ name: string }> = await db.pool.query(
        'SELECT r.name FROM tenant_membership_role m JOIN tenant_role r ON r.id=m.tenant_role_id WHERE m.tenant_id=$1 AND m.principal_id=$2',
        [book.id, principal],
      );
      assert.deepEqual(
        assigned.rows.map((row: { name: string }): string => row.name),
        expected,
      );
    }
    assert.equal(
      (await db.pool.query('SELECT public_id FROM recipe WHERE tenant_id=$1', [book.id])).rows[0]
        .public_id,
      recipe.rows[0]!.public_id,
    );
    assert.ok(
      (await pendingCookbookResets(db.pool, next.principalId)).some(
        (item: { publicId: string }): boolean => item.publicId === book.publicId,
      ),
    );
    assert.ok(
      !(await pendingCookbookResets(db.pool, old.principalId)).some(
        (item: { publicId: string }): boolean => item.publicId === book.publicId,
      ),
    );
    assert.deepEqual(
      (
        await db.pool.query('SELECT * FROM recipe_revision WHERE recipe_id=$1', [
          recipe.rows[0]!.id,
        ])
      ).rows,
      authored.rows,
    );
    const audit: QueryResult = await db.pool.query(
      'SELECT previous_state,new_state FROM administrative_audit_event WHERE request_id=$1',
      [response.headers['x-request-id']],
    );
    assert.equal(audit.rows[0].previous_state.ownerPrincipalId, old.principalId);
    assert.equal(audit.rows[0].new_state.ownerPrincipalId, next.principalId);
    assert.equal(audit.rows[0].new_state.roleCode, role);
  }
});

test('disabled/deleted/service recipients are rejected and inactive former owners can be recovered', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  for (const column of ['disabled_at', 'deleted_at']) {
    await db.pool.query(`UPDATE user_account SET ${column}=now() WHERE id=$1`, [alternate.userId]);
    assert.equal((await transfer(book, { recipientPublicId: alternatePublic })).statusCode, 400);
    await db.pool.query(`UPDATE user_account SET ${column}=NULL WHERE id=$1`, [alternate.userId]);
  }
  await db.pool.query('UPDATE principal SET disabled_at=now() WHERE id=$1', [
    alternate.principalId,
  ]);
  assert.equal((await transfer(book, { recipientPublicId: alternatePublic })).statusCode, 400);
  await db.pool.query('UPDATE principal SET disabled_at=NULL WHERE id=$1', [alternate.principalId]);
  const service: QueryResult<{ public_id: string }> = await db.pool.query(
    "WITH p AS (INSERT INTO principal (principal_type) VALUES ('SERVICE_ACCOUNT') RETURNING id) INSERT INTO service_account (principal_id,tenant_id,name) SELECT id,$1,'Service' FROM p RETURNING public_id",
    [book.id],
  );
  assert.equal(
    (await transfer(book, { recipientPublicId: service.rows[0]!.public_id })).statusCode,
    400,
  );
  await db.pool.query('UPDATE user_account SET disabled_at=now(),deleted_at=now() WHERE id=$1', [
    old.userId,
  ]);
  try {
    assert.equal((await transfer(book)).statusCode, 200);
  } finally {
    await db.pool.query('UPDATE user_account SET disabled_at=NULL,deleted_at=NULL WHERE id=$1', [
      old.userId,
    ]);
  }
});

test('concurrent stale transfers serialize to one coherent owner', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  const responses: LightMyRequestResponse[] = await Promise.all([
    transfer(book),
    transfer(book, { recipientPublicId: alternatePublic }),
  ]);
  assert.deepEqual(
    responses.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [200, 409],
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT 1 FROM tenant_membership_role m JOIN tenant_role r ON r.id=m.tenant_role_id WHERE m.tenant_id=$1 AND r.name='Owner'",
        [book.id],
      )
    ).rowCount,
    1,
  );
});

test('audit failure rolls back ownership and inconsistent Owner roles fail without altering the cookbook', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_transfer CHECK (action <> 'ADMIN_OWNERSHIP_TRANSFERRED') NOT VALID",
  );
  try {
    assert.equal((await transfer(book)).statusCode, 500);
    assert.equal(
      (await db.pool.query('SELECT owner_principal_id FROM tenant WHERE id=$1', [book.id])).rows[0]
        .owner_principal_id,
      old.principalId,
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT 1 FROM tenant_membership WHERE tenant_id=$1 AND principal_id=$2',
          [book.id, next.principalId],
        )
      ).rowCount,
      0,
    );
  } finally {
    await db.pool.query('ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_transfer');
  }
  await db.pool.query(
    "DELETE FROM tenant_role_permission WHERE tenant_role_id IN (SELECT id FROM tenant_role WHERE tenant_id=$1 AND name='Owner') AND permission_code='recipe:publish'",
    [book.id],
  );
  assert.equal((await transfer(book)).json().code, 'OWNERSHIP_ROLE_CONFLICT');
});

test('unclaimed ownership is assigned without leaving pending owner invitations', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  await db.pool.query('UPDATE tenant SET owner_principal_id=NULL WHERE id=$1', [book.id]);
  await db.pool.query('DELETE FROM tenant_membership WHERE tenant_id=$1 AND principal_id=$2', [
    book.id,
    old.principalId,
  ]);
  await db.pool.query(
    "INSERT INTO tenant_invitation (tenant_id,invited_email,tenant_role_id,token_hash,expires_at,created_by_principal_id) SELECT $1,'pending@example.test',id,decode('aa','hex'),now()+interval '1 day',$2 FROM tenant_role WHERE tenant_id=$1 AND name='Owner'",
    [book.id, admin.principalId],
  );
  const response: LightMyRequestResponse = await transfer(book, { expectedOwnerPublicId: null });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().notifications.length, 1);
  assert.equal(
    (
      await db.pool.query(
        'SELECT 1 FROM tenant_invitation WHERE tenant_id=$1 AND accepted_at IS NULL',
        [book.id],
      )
    ).rowCount,
    0,
  );
});

test('owner notifications run after commit and delivery failures remain operator-visible', async (context: TestContext): Promise<void> => {
  await db.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host,smtp_port,transport_security,from_email,from_name,updated_by_principal_id) VALUES ('smtp.invalid',587,'STARTTLS','noreply@example.test','Shadowcook',$1)",
    [admin.principalId],
  );
  const book: Cookbook = await cookbook();
  let deliveries: number = 0;
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (message: { to: string; text: string }): Promise<object> => {
      assert.equal(
        (await db.pool.query('SELECT owner_principal_id FROM tenant WHERE id=$1', [book.id]))
          .rows[0].owner_principal_id,
        next.principalId,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT 1 FROM administrative_audit_event WHERE target_public_id=$1 AND action='ADMIN_OWNERSHIP_TRANSFERRED'",
            [book.publicId],
          )
        ).rowCount,
        1,
      );
      assert.ok(!message.text.includes('Verified recovery request'));
      deliveries++;
      if (message.to === old.email) throw new Error('Simulated SMTP rejection');
      return {};
    },
  }));
  const response: LightMyRequestResponse = await transfer(book);
  assert.equal(response.statusCode, 200);
  assert.equal(deliveries, 2);
  assert.deepEqual(response.json().notifications, [
    { recipient: 'OLD_OWNER', status: 'FAILED' },
    { recipient: 'NEW_OWNER', status: 'SENT' },
  ]);
  assert.equal(
    (await db.pool.query('SELECT owner_principal_id FROM tenant WHERE id=$1', [book.id])).rows[0]
      .owner_principal_id,
    next.principalId,
  );
});

test('administration shows the canonical owner and conflicting extra Owner assignments require review', async (): Promise<void> => {
  const book: Cookbook = await cookbook();
  await db.pool.query('INSERT INTO tenant_membership (tenant_id,principal_id) VALUES ($1,$2)', [
    book.id,
    alternate.principalId,
  ]);
  await db.pool.query(
    "INSERT INTO tenant_membership_role SELECT $1,$2,id FROM tenant_role WHERE tenant_id=$1 AND name='Owner'",
    [book.id, alternate.principalId],
  );
  const listed: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { cookie },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(
    listed
      .json()
      .tenants.find((item: { public_id: string }): boolean => item.public_id === book.publicId)
      .owner_name,
    'Test user',
  );
  assert.equal((await transfer(book)).json().code, 'OWNERSHIP_ROLE_CONFLICT');
});
