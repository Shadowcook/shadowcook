import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { before, after, test, type TestContext } from 'node:test';
import nodemailer from 'nodemailer';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import { createOwnedCookbook, type OwnedCookbook } from '../../src/cookbook/owned-cookbook.js';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';
let db: DisposablePostgresDatabase;
let api: FastifyInstance;
let a: TestUser;
let b: TestUser;
let owner: TestUser;
let aCookie: string;
let bCookie: string;
let ownerCookie: string;
let aId: string;
let bId: string;
let ownerId: string;
interface Book extends OwnedCookbook {
  publicId: string;
}
async function id(user: TestUser): Promise<string> {
  return (
    await db.pool.query<{ public_id: string }>('SELECT public_id FROM user_account WHERE id=$1', [
      user.userId,
    ])
  ).rows[0]!.public_id;
}
async function session(user: TestUser): Promise<string> {
  const value: BrowserSession = await issueSession(db.pool, user.userId);
  return `shadowcook_session=${value.token}`;
}
async function call(
  method: 'POST' | 'DELETE' | 'PATCH' | 'PUT',
  url: string,
  payload: object,
  auth: string = aCookie,
): Promise<LightMyRequestResponse> {
  return api.inject({ method, url, payload, headers: { cookie: auth } });
}
async function book(): Promise<Book> {
  const client: PoolClient = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const value: OwnedCookbook = await createOwnedCookbook(
      client,
      owner.principalId,
      `Safety ${randomUUID()}`,
      100,
    );
    await client.query('COMMIT');
    return {
      ...value,
      publicId: (
        await db.pool.query<{ public_id: string }>('SELECT public_id FROM tenant WHERE id=$1', [
          value.id,
        ])
      ).rows[0]!.public_id,
    };
  } finally {
    client.release();
  }
}
before(async (): Promise<void> => {
  db = await createDisposablePostgresDatabase();
  api = createTestApi(db.pool);
  a = await createTestUser(db.pool, { email: 'safety-a@example.test' });
  b = await createTestUser(db.pool, { email: 'safety-b@example.test' });
  owner = await createTestUser(db.pool, { email: 'safety-owner@example.test' });
  for (const user of [a, b])
    await db.pool.query(
      "INSERT INTO principal_instance_role SELECT $1,id FROM instance_role WHERE code='administrator'",
      [user.principalId],
    );
  aCookie = await session(a);
  bCookie = await session(b);
  ownerCookie = await session(owner);
  aId = await id(a);
  bId = await id(b);
  ownerId = await id(owner);
});
after(async (): Promise<void> => {
  if (api) await api.close();
  if (db) await db.close();
});

test('permanent cookbook deletion requires review, exact UUID, preservation decision and surviving audit', async (): Promise<void> => {
  const target: Book = await book();
  const path: string = `/admin/tenants/${target.publicId}`;
  assert.equal(
    (await call('POST', `${path}/deletion-preview`, { reason: 'Review' }, ownerCookie)).statusCode,
    403,
  );
  await db.pool.query(
    "INSERT INTO principal_instance_role SELECT $1,id FROM instance_role WHERE code='tenant-manager'",
    [owner.principalId],
  );
  assert.equal(
    (await call('POST', `${path}/deletion-preview`, { reason: 'Review' }, ownerCookie)).statusCode,
    403,
  );
  assert.equal((await call('DELETE', path, { reason: 'Review' }, ownerCookie)).statusCode, 403);
  const preview: LightMyRequestResponse = await call('POST', `${path}/deletion-preview`, {
    reason: 'Reviewed report',
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const payload: object = {
    reason: 'Preservation reviewed; no hold',
    confirmation: target.publicId,
    preservationReviewed: true,
    expectedScope: preview.json(),
  };
  for (const change of [{ confirmation: 'wrong' }, { preservationReviewed: false }, { reason: '' }])
    assert.equal((await call('DELETE', path, { ...payload, ...change })).statusCode, 400);
  await db.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT reject_delete CHECK (action <> 'ADMIN_COOKBOOK_DELETED') NOT VALID",
  );
  try {
    assert.equal((await call('DELETE', path, payload)).statusCode, 500);
    assert.equal(
      (await db.pool.query('SELECT 1 FROM tenant WHERE id=$1', [target.id])).rowCount,
      1,
    );
  } finally {
    await db.pool.query('ALTER TABLE administrative_audit_event DROP CONSTRAINT reject_delete');
  }
  const result: LightMyRequestResponse = await call('DELETE', path, payload);
  assert.equal(result.statusCode, 204, result.body);
  assert.equal((await db.pool.query('SELECT 1 FROM tenant WHERE id=$1', [target.id])).rowCount, 0);
  const audit: QueryResult = await db.pool.query(
    'SELECT * FROM administrative_audit_event WHERE request_id=$1',
    [result.headers['x-request-id']],
  );
  assert.equal(audit.rows[0].target_public_id, target.publicId);
  assert.equal(audit.rows[0].new_state.status, 'PERMANENTLY_DELETED');
  assert.equal(audit.rows[0].previous_state.preservationReviewed, true);
});

test('permanent recipe deletion is scoped, detects changed scope and preserves shared media with durable last-reference cleanup', async (): Promise<void> => {
  const target: Book = await book();
  const recipes: { id: string; public_id: string; revision: string }[] = [];
  for (const slug of ['one', 'two']) {
    const row: { id: string; public_id: string } = (
      await db.pool.query<{ id: string; public_id: string }>(
        'INSERT INTO recipe (tenant_id,lineage_public_id,slug) VALUES ($1,gen_random_uuid(),$2) RETURNING id,public_id',
        [target.id, slug],
      )
    ).rows[0]!;
    const revision: string = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO recipe_revision (recipe_id,revision_no,status,title) VALUES ($1,1,'DRAFT','Preserved history') RETURNING id",
        [row.id],
      )
    ).rows[0]!.id;
    recipes.push({ ...row, revision });
  }
  const key: string = randomUUID();
  const asset: string = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO media_asset (tenant_id,storage_key,content_type,byte_size,checksum) VALUES ($1,$2,'image/jpeg',0,decode('aa','hex')) RETURNING id",
      [target.id, key],
    )
  ).rows[0]!.id;
  for (const item of recipes)
    await db.pool.query(
      "INSERT INTO recipe_revision_media (recipe_revision_id,media_asset_id,usage_kind) VALUES ($1,$2,'COVER')",
      [item.revision, asset],
    );
  await db.pool
    .query(`CREATE FUNCTION require_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM administrative_audit_event WHERE (action='ADMIN_RECIPE_DELETED' AND target_public_id=OLD.public_id) OR (action='ADMIN_COOKBOOK_DELETED' AND target_public_id=(SELECT public_id FROM tenant WHERE id=OLD.tenant_id))) THEN RAISE EXCEPTION 'Required audit must exist before deletion'; END IF; RETURN OLD; END $$;
 CREATE TRIGGER require_deletion_audit BEFORE DELETE ON recipe FOR EACH ROW EXECUTE FUNCTION require_deletion_audit()`);
  const first: string = `/admin/tenants/${target.publicId}/recipes/${recipes[0].public_id}`;
  const scope: object = (
    await call('POST', `${first}/deletion-preview`, { reason: 'Review' })
  ).json();
  assert.equal(
    (
      await call('DELETE', first, {
        reason: 'Delete',
        confirmation: recipes[0].public_id,
        preservationReviewed: true,
        expectedScope: { ...scope, revisionCount: 99 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call('DELETE', first, {
        reason: 'Delete',
        confirmation: recipes[0].public_id,
        preservationReviewed: true,
        expectedScope: scope,
      })
    ).statusCode,
    204,
  );
  assert.equal((await db.pool.query('SELECT 1 FROM media_asset WHERE id=$1', [asset])).rowCount, 1);
  const path: string = `/admin/tenants/${target.publicId}`;
  const total: object = (
    await call('POST', `${path}/deletion-preview`, { reason: 'Review' })
  ).json();
  assert.equal(
    (
      await call('DELETE', path, {
        reason: 'Delete',
        confirmation: target.publicId,
        preservationReviewed: true,
        expectedScope: total,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await db.pool.query('SELECT 1 FROM recipe_media_deletion_queue WHERE storage_key=$1', [key]))
      .rowCount,
    1,
  );
  assert.equal(
    (await db.pool.query('SELECT 1 FROM recipe WHERE tenant_id=$1', [target.id])).rowCount,
    0,
  );
  await db.pool.query(
    'DROP TRIGGER require_deletion_audit ON recipe; DROP FUNCTION require_deletion_audit()',
  );
});

test('account deletion requires ownership resolution and disabling revokes sessions and recovery access', async (): Promise<void> => {
  const target: Book = await book();
  const deleted: LightMyRequestResponse = await call('DELETE', `/admin/users/${ownerId}`, {
    reason: 'Review',
    confirmed: true,
    confirmation: ownerId,
  });
  assert.equal(deleted.statusCode, 409);
  assert.equal(deleted.json().code, 'OWNED_COOKBOOKS_REMAIN');
  const disabled: LightMyRequestResponse = await call('PATCH', `/admin/users/${ownerId}`, {
    reason: 'Security containment',
    confirmed: true,
    disabled: true,
  });
  assert.equal(disabled.statusCode, 204, disabled.body);
  assert.equal(
    (await api.inject({ method: 'GET', url: '/auth/session', headers: { cookie: ownerCookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await db.pool.query('SELECT owner_principal_id FROM tenant WHERE id=$1', [target.id])).rows[0]
      .owner_principal_id,
    owner.principalId,
  );
  assert.equal(
    (
      await call('PATCH', `/admin/users/${ownerId}`, {
        reason: 'Resolved',
        confirmed: true,
        disabled: false,
      })
    ).statusCode,
    204,
  );
});

test('email recovery completes asynchronously by recipient link, revokes access and notifies after commit', async (context: TestContext): Promise<void> => {
  await db.pool.query(
    "INSERT INTO instance_mail_settings (smtp_host,smtp_port,transport_security,from_email,from_name,updated_by_principal_id) VALUES ('smtp.invalid',587,'STARTTLS','noreply@example.test','Shadowcook',$1)",
    [a.principalId],
  );
  let token: string = '';
  let notifications: number = 0;
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (message: { to: string; text: string }): Promise<object> => {
      const match: RegExpMatchArray | null = message.text.match(/[A-Za-z0-9_-]{43}/);
      if (match) {
        token = match[0];
        assert.equal(message.to, 'recovered@example.test');
      } else {
        notifications++;
        assert.equal(
          (await db.pool.query('SELECT email FROM user_account WHERE id=$1', [owner.userId]))
            .rows[0].email,
          'recovered@example.test',
        );
        if (message.to === owner.email) throw new Error('Simulated prior-address delivery failure');
      }
      return {};
    },
  }));
  const path: string = `/admin/users/${ownerId}`;
  const proof: LightMyRequestResponse = await call('POST', `${path}/email-recovery`, {
    reason: 'Recovery verified independently',
    confirmed: true,
    email: 'recovered@example.test',
  });
  assert.equal(proof.statusCode, 200, proof.body);
  assert.ok(token);
  assert.ok(!proof.body.includes(token));
  assert.equal(
    (
      await db.pool.query(
        'SELECT token_hash FROM administrative_email_recovery WHERE user_account_id=$1',
        [owner.userId],
      )
    ).rows[0].token_hash.toString('hex'),
    createHash('sha256').update(token).digest('hex'),
  );
  assert.equal(
    (await db.pool.query('SELECT email FROM user_account WHERE id=$1', [owner.userId])).rows[0]
      .email,
    owner.email,
  );
  const completionPath: string = '/auth/email-recovery/complete';
  let payload: object = { token };
  assert.equal((await call('POST', completionPath, { token: randomUUID() }, '')).statusCode, 400);
  // A duplicate issuance is rate limited, without changing the existing request.
  assert.equal(
    (
      await call('POST', `${path}/email-recovery`, {
        reason: 'Recovery verified independently',
        confirmed: true,
        email: 'recovered@example.test',
      })
    ).statusCode,
    429,
  );
  const previousToken: string = token;
  await db.pool.query(
    "UPDATE administrative_email_recovery SET created_at=now()-interval '2 minutes' WHERE user_account_id=$1",
    [owner.userId],
  );
  assert.equal(
    (
      await call('POST', `${path}/email-recovery`, {
        reason: 'Recovery verified independently',
        confirmed: true,
        email: 'recovered@example.test',
      })
    ).statusCode,
    200,
  );
  assert.notEqual(token, previousToken);
  assert.equal((await call('POST', completionPath, { token: previousToken }, '')).statusCode, 400);
  payload = { token };
  await db.pool.query(
    "UPDATE administrative_email_recovery SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE user_account_id=$1",
    [owner.userId],
  );
  assert.equal((await call('POST', completionPath, payload, '')).statusCode, 400);
  await db.pool.query(
    "UPDATE administrative_email_recovery SET expires_at=now()+interval '1 hour' WHERE user_account_id=$1",
    [owner.userId],
  );
  await db.pool.query('UPDATE user_account SET disabled_at=now() WHERE id=$1', [owner.userId]);
  assert.equal((await call('POST', completionPath, payload, '')).statusCode, 400);
  await db.pool.query('UPDATE user_account SET disabled_at=NULL WHERE id=$1', [owner.userId]);
  // An address claimed since issuance must not consume recovery or revoke access.
  const conflicting: TestUser = await createTestUser(db.pool, { email: 'recovered@example.test' });
  assert.equal((await call('POST', completionPath, payload, '')).statusCode, 409);
  assert.equal(
    (await db.pool.query('SELECT email FROM user_account WHERE id=$1', [owner.userId])).rows[0]
      .email,
    owner.email,
  );
  await db.pool.query('UPDATE user_account SET email=$1 WHERE id=$2', [
    'other-recovery@example.test',
    conflicting.userId,
  ]);
  const result: LightMyRequestResponse = await call('POST', completionPath, payload, '');
  assert.equal(result.statusCode, 204, result.body);
  assert.equal(notifications, 2);
  assert.equal((await call('POST', completionPath, payload, '')).statusCode, 400);
  assert.equal(
    (await api.inject({ method: 'GET', url: '/auth/session', headers: { cookie: ownerCookie } }))
      .statusCode,
    401,
  );
  const audit: QueryResult = await db.pool.query(
    "SELECT actor_principal_id,reason,new_state FROM administrative_audit_event WHERE action='ADMIN_USER_EMAIL_RECOVERED' AND target_public_id=$1",
    [ownerId],
  );
  assert.equal(audit.rows[0].actor_principal_id, a.principalId);
  assert.equal(audit.rows[0].reason, 'Recovery verified independently');
  assert.equal(audit.rows[0].new_state.confirmation, 'RECIPIENT_LINK');
  assert.equal(
    (await db.pool.query('SELECT principal_id FROM user_account WHERE id=$1', [owner.userId]))
      .rows[0].principal_id,
    owner.principalId,
  );
});

test('account deletion after ownership resolution revokes tokens and preserves the historical principal and audit', async (): Promise<void> => {
  const user: TestUser = await createTestUser(db.pool, { email: 'delete-safe@example.test' });
  const publicId: string = await id(user);
  const cookie: string = await session(user);
  await db.pool.query(
    "INSERT INTO oauth_access_token (principal_id,token_hash,client_id,resource,scope,expires_at) VALUES ($1,decode('abcd','hex'),'client','resource','shadowcook:recipes',now()+interval '1 hour')",
    [user.principalId],
  );
  const response: LightMyRequestResponse = await call('DELETE', `/admin/users/${publicId}`, {
    reason: 'Ownership resolved and account removal verified',
    confirmed: true,
    confirmation: publicId,
  });
  assert.equal(response.statusCode, 204, response.body);
  assert.equal(
    (await api.inject({ method: 'GET', url: '/auth/session', headers: { cookie } })).statusCode,
    401,
  );
  assert.ok(
    (
      await db.pool.query('SELECT revoked_at FROM oauth_access_token WHERE principal_id=$1', [
        user.principalId,
      ])
    ).rows[0].revoked_at,
  );
  assert.equal(
    (await db.pool.query('SELECT 1 FROM principal WHERE id=$1', [user.principalId])).rowCount,
    1,
  );
  assert.equal(
    (
      await db.pool.query(
        'SELECT target_public_id FROM administrative_audit_event WHERE request_id=$1',
        [response.headers['x-request-id']],
      )
    ).rows[0].target_public_id,
    publicId,
  );
});

test('account deletion and self-service cookbook creation cannot leave a deleted canonical owner', async (): Promise<void> => {
  const creator: TestUser = await createTestUser(db.pool, { email: 'race-creator@example.test' });
  const publicId: string = await id(creator);
  const auth: string = await session(creator);
  const results: LightMyRequestResponse[] = await Promise.all([
    call('DELETE', `/admin/users/${publicId}`, {
      reason: 'Ownership resolution checked',
      confirmed: true,
      confirmation: publicId,
    }),
    call('POST', '/account/cookbooks', { cookbookName: 'Race Cookbook' }, auth),
  ]);
  assert.ok(
    (results[0].statusCode === 204 && results[1].statusCode === 401) ||
      (results[0].statusCode === 409 && results[1].statusCode === 201),
    results
      .map((response: LightMyRequestResponse): string => `${response.statusCode} ${response.body}`)
      .join(' | '),
  );
  if (results[0].statusCode === 204)
    assert.equal(
      (
        await db.pool.query('SELECT 1 FROM tenant WHERE owner_principal_id=$1', [
          creator.principalId,
        ])
      ).rowCount,
      0,
    );
});

test('simultaneous administrator removals serialize and preserve the last usable administrator', async (): Promise<void> => {
  const responses: LightMyRequestResponse[] = await Promise.all([
    call(
      'PATCH',
      `/admin/users/${aId}`,
      { reason: 'Deactivate A', confirmed: true, disabled: true },
      aCookie,
    ),
    call(
      'PATCH',
      `/admin/users/${bId}`,
      { reason: 'Deactivate B', confirmed: true, disabled: true },
      bCookie,
    ),
  ]);
  assert.deepEqual(
    responses.map((item: LightMyRequestResponse): number => item.statusCode).sort(),
    [204, 409],
  );
  const active: string = responses[0].statusCode === 204 ? bId : aId;
  const auth: string = responses[0].statusCode === 204 ? bCookie : aCookie;
  assert.equal(
    (
      await call(
        'PUT',
        `/admin/users/${active}/instance-roles`,
        { reason: 'Remove role', confirmed: true, roleCodes: [] },
        auth,
      )
    ).json().code,
    'LAST_USABLE_ADMINISTRATOR',
  );
  assert.equal(
    (
      await call(
        'DELETE',
        `/admin/users/${active}`,
        { reason: 'Remove account', confirmed: true, confirmation: active },
        auth,
      )
    ).json().code,
    'LAST_USABLE_ADMINISTRATOR',
  );
});
