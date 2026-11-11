import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  LightMyRequestResponse,
} from 'fastify';
import type { PoolClient, QueryResult } from 'pg';
import { issueSession, type BrowserSession } from '../../src/auth/browser-session.js';
import {
  executeAdministrativeMutation,
  executeAdministrativeRead,
  type AdministrativeResult,
  type AdministrativeTarget,
} from '../../src/admin/audit-operation.js';
import {
  pruneAdministrativeAudit,
  setAuditRetentionDays,
} from '../../src/admin/audit-retention.js';
import { createTestApi } from '../helpers/api.js';
import {
  createTestUser,
  assignTenantRole,
  createTestTenant,
  type TestUser,
  type TestTenant,
} from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let administrator: TestUser;
let adminCookie: string;
let tenant: TestTenant;
const cookies: Record<string, string> = {};
const bearerTokens: string[] = [];

async function session(user: TestUser): Promise<string> {
  const issued: BrowserSession = await issueSession(database.pool, user.userId);
  return `shadowcook_session=${issued.token}`;
}
async function actor(name: string, role: string | null): Promise<TestUser> {
  const user: TestUser = await createTestUser(database.pool, { email: `${name}@example.test` });
  if (role !== null)
    await database.pool.query(
      'INSERT INTO principal_instance_role SELECT $1, id FROM instance_role WHERE code = $2',
      [user.principalId, role],
    );
  cookies[name] = await session(user);
  return user;
}
async function countEvents(): Promise<number> {
  const result: QueryResult<{ count: number }> = await database.pool.query(
    'SELECT count(*)::integer AS count FROM administrative_audit_event',
  );
  return result.rows[0]!.count;
}
async function invoke(
  mode: string,
  cookie: string | undefined = adminCookie,
  payload: object = { reason: 'Investigate a reported issue' },
  authorization?: string,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (authorization !== undefined) headers.authorization = authorization;
  return api.inject({ method: 'POST', url: `/phase-one-test/${mode}`, headers, payload });
}

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  administrator = await actor('administrator', 'administrator');
  adminCookie = cookies.administrator!;
  await actor('ordinary', null);
  await actor('manager', 'tenant-manager');
  const owner: TestUser = await actor('foreign-owner', null);
  const foreignTenant: TestTenant = await assignTenantRole(
    database.pool,
    owner.principalId,
    'foreign-owner',
    ['tenant:manage'],
  );
  await database.pool.query('UPDATE tenant SET owner_principal_id = $1 WHERE id = $2', [
    owner.principalId,
    foreignTenant.id,
  ]);
  for (const state of [
    'disabled',
    'deleted',
    'principal-disabled',
    'password',
    'reset',
    'revoked',
    'expired',
  ]) {
    const user: TestUser = await actor(state, 'administrator');
    if (state === 'disabled' || state === 'deleted')
      await database.pool.query(
        `UPDATE user_account SET ${state === 'disabled' ? 'disabled_at' : 'deleted_at'} = now() WHERE id = $1`,
        [user.userId],
      );
    if (state === 'principal-disabled')
      await database.pool.query('UPDATE principal SET disabled_at = now() WHERE id = $1', [
        user.principalId,
      ]);
    if (state === 'password')
      await database.pool.query(
        'UPDATE user_account SET password_change_required = true WHERE id = $1',
        [user.userId],
      );
    if (state === 'reset') {
      const locked: TestTenant = await assignTenantRole(
        database.pool,
        user.principalId,
        'reset-owner',
      );
      await database.pool.query(
        'UPDATE tenant SET owner_principal_id = $1, name_reset_required = true WHERE id = $2',
        [user.principalId, locked.id],
      );
    }
    if (state === 'revoked' || state === 'expired')
      await database.pool.query(
        `UPDATE user_session SET ${state === 'revoked' ? 'revoked_at = now()' : "created_at = now() - interval '2 days', expires_at = now() - interval '1 day'"} WHERE user_account_id = $1`,
        [user.userId],
      );
  }
  tenant = await createTestTenant(database.pool, 'audit-target');
  const oauthToken: string = randomBytes(32).toString('base64url');
  await database.pool.query(
    "INSERT INTO oauth_access_token (token_hash, principal_id, client_id, resource, scope, expires_at) VALUES ($1, $2, 'test-client', 'http://test-api.invalid/mcp', 'shadowcook:recipes', now() + interval '1 hour')",
    [createHash('sha256').update(oauthToken).digest(), administrator.principalId],
  );
  const serviceToken: string = randomBytes(32).toString('base64url');
  const service: QueryResult<{ id: string }> = await database.pool.query(
    "WITH p AS (INSERT INTO principal (principal_type) VALUES ('SERVICE_ACCOUNT') RETURNING id) INSERT INTO service_account (principal_id, tenant_id, name) SELECT p.id, $1, 'Test service' FROM p RETURNING id",
    [tenant.id],
  );
  await database.pool.query(
    "INSERT INTO api_token (service_account_id, name, token_prefix, token_hash) VALUES ($1, 'Test token', $2, $3)",
    [
      service.rows[0]!.id,
      serviceToken.slice(0, 8),
      createHash('sha256').update(serviceToken).digest(),
    ],
  );
  bearerTokens.push(oauthToken, serviceToken, 'malformed');
  api = createTestApi(database.pool);
  // These handlers exercise infrastructure only; they are never registered in the product API.
  api.post(
    '/phase-one-test/:mode',
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const mode: string = (request.params as { mode: string }).mode;
      const target: AdministrativeTarget = {
        action: mode.includes('audit-failure') ? 'ADMIN_TEST_FAILURE' : 'ADMIN_TEST_OPERATION',
        targetType: 'COOKBOOK',
        targetPublicId: tenant.publicId,
        cookbookPublicId: tenant.publicId,
      };
      const work: (
        client: PoolClient,
        actorId: string,
      ) => Promise<AdministrativeResult<string>> = async (
        client: PoolClient,
      ): Promise<AdministrativeResult<string>> => {
        if (!mode.startsWith('read') || mode === 'read-write')
          await client.query("UPDATE tenant SET description = 'Changed' WHERE id = $1", [
            tenant.id,
          ]);
        if (mode === 'action-failure') throw new Error('Simulated action failure');
        if (mode === 'read-revoke')
          await database.pool.query(
            'UPDATE user_session SET revoked_at = now() WHERE user_account_id = $1',
            [administrator.userId],
          );
        const result: QueryResult<{ display_name: string }> = await client.query(
          'SELECT display_name FROM tenant WHERE id = $1',
          [tenant.id],
        );
        return mode.startsWith('read')
          ? { value: result.rows[0]!.display_name }
          : { value: 'changed', previousState: { disabled: false }, newState: { disabled: false } };
      };
      const result: AdministrativeResult<string> | null = mode.startsWith('read')
        ? await executeAdministrativeRead(database.pool, request, reply, target, request.body, work)
        : await executeAdministrativeMutation(
            database.pool,
            request,
            reply,
            target,
            request.body,
            work,
          );
      if (result === null) return;
      return { value: result.value };
    },
  );
  await api.ready();
});
after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('sensitive operations reject non-admin humans, bearer credentials, inactive identities and stale sessions', async (): Promise<void> => {
  const original: number = await countEvents();
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/phase-one-test/read',
        payload: { reason: 'Review' },
      })
    ).statusCode,
    401,
  );
  for (const name of [
    'ordinary',
    'manager',
    'foreign-owner',
    'disabled',
    'deleted',
    'principal-disabled',
    'password',
    'reset',
    'revoked',
    'expired',
  ]) {
    const response: LightMyRequestResponse = await invoke('read', cookies[name]);
    assert.ok([401, 403].includes(response.statusCode), `${name}: ${response.body}`);
    assert.ok(!response.body.includes('Test tenant'));
  }
  // All bearer transports (including service and human OAuth) are denied even beside an admin session.
  for (const bearer of bearerTokens) {
    assert.equal(
      (await invoke('read', adminCookie, { reason: 'Review' }, `Bearer ${bearer}`)).statusCode,
      403,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: '/phase-one-test/read',
          headers: { authorization: `Bearer ${bearer}` },
          payload: { reason: 'Review' },
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(await countEvents(), original);
  assert.equal(
    (await database.pool.query('SELECT 1 FROM tenant_membership WHERE tenant_id = $1', [tenant.id]))
      .rowCount,
    0,
  );
});

test('missing/forged reasons and nonexistent report correlation fail before work or audit', async (): Promise<void> => {
  const original: number = await countEvents();
  for (const payload of [
    {},
    { reason: '' },
    { reason: ' ' },
    { reason: 'x'.repeat(2001) },
    { reason: 'Review', relatedReportPublicId: randomUUID() },
    { reason: 'Review', actorPrincipalId: administrator.principalId },
  ]) {
    assert.equal((await invoke('mutation', adminCookie, payload)).statusCode, 400);
  }
  assert.equal(await countEvents(), original);
  assert.equal(
    (await database.pool.query('SELECT description FROM tenant WHERE id = $1', [tenant.id])).rows[0]
      .description,
    null,
  );
});

test('reads and mutations persist attribution, normalized purpose, state and server request/report correlation', async (): Promise<void> => {
  const report: QueryResult<{ public_id: string }> = await database.pool.query(
    "INSERT INTO content_report (reporter_user_id, target_type, target_public_id, reason, description) VALUES ($1, 'COOKBOOK', $2, 'OTHER', 'Report') RETURNING public_id",
    [administrator.userId, tenant.publicId],
  );
  const reportId: string = report.rows[0]!.public_id;
  const response: LightMyRequestResponse = await invoke('mutation', adminCookie, {
    reason: '  Verified issue  ',
    relatedReportPublicId: reportId,
  });
  assert.equal(response.statusCode, 200, response.body);
  const event: QueryResult = await database.pool.query(
    'SELECT * FROM administrative_audit_event WHERE request_id = $1',
    [response.headers['x-request-id']],
  );
  assert.equal(event.rowCount, 1);
  assert.equal(event.rows[0].actor_principal_id, administrator.principalId);
  assert.equal(event.rows[0].reason, 'Verified issue');
  assert.equal(event.rows[0].related_report_public_id, reportId);
  assert.equal(event.rows[0].outcome, 'SUCCEEDED');
  assert.deepEqual(event.rows[0].new_state, { disabled: false });
  assert.ok(event.rows[0].created_at instanceof Date);
  await database.pool.query('DELETE FROM content_report WHERE public_id = $1', [reportId]);
  assert.equal(
    (
      await database.pool.query(
        'SELECT related_report_public_id FROM administrative_audit_event WHERE id = $1',
        [event.rows[0].id],
      )
    ).rows[0].related_report_public_id,
    reportId,
  );
  const read: LightMyRequestResponse = await invoke('read');
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), { value: 'Test tenant' });
  assert.equal(
    (
      await database.pool.query(
        'SELECT new_state FROM administrative_audit_event WHERE request_id = $1',
        [read.headers['x-request-id']],
      )
    ).rows[0].new_state,
    null,
  );
  assert.equal(
    (await database.pool.query('SELECT 1 FROM tenant_membership WHERE tenant_id = $1', [tenant.id]))
      .rowCount,
    0,
  );
});

test('action/audit failures roll back changes; audit failures and write attempts prevent read responses', async (): Promise<void> => {
  await database.pool.query('UPDATE tenant SET description = NULL WHERE id = $1', [tenant.id]);
  const original: number = await countEvents();
  await database.pool.query(
    "ALTER TABLE administrative_audit_event ADD CONSTRAINT test_reject_event CHECK (action <> 'ADMIN_TEST_FAILURE')",
  );
  try {
    for (const mode of ['action-failure', 'audit-failure', 'read-audit-failure', 'read-write']) {
      const response: LightMyRequestResponse = await invoke(mode);
      assert.equal(response.statusCode, 500, response.body);
      assert.ok(!response.body.includes('Test tenant'));
      assert.equal(await countEvents(), original);
      assert.equal(
        (await database.pool.query('SELECT description FROM tenant WHERE id = $1', [tenant.id]))
          .rows[0].description,
        null,
      );
    }
  } finally {
    await database.pool.query(
      'ALTER TABLE administrative_audit_event DROP CONSTRAINT test_reject_event',
    );
  }
});

test('inspection cannot return data after its session is revoked during the read', async (): Promise<void> => {
  const original: number = await countEvents();
  try {
    const response: LightMyRequestResponse = await invoke('read-revoke');
    assert.equal(response.statusCode, 401);
    assert.ok(!response.body.includes('Test tenant'));
    assert.equal(await countEvents(), original);
  } finally {
    await database.pool.query(
      'UPDATE user_session SET revoked_at = NULL WHERE user_account_id = $1',
      [administrator.userId],
    );
  }
});

test('finite operator retention prunes only expired events and rejects invalid policy', async (): Promise<void> => {
  for (const days of [0, 3651, 1.5])
    await assert.rejects(setAuditRetentionDays(database.pool, days));
  await setAuditRetentionDays(database.pool, 10);
  const ids: string[] = [];
  for (const age of [11, 9]) {
    const event: QueryResult<{ id: string }> = await database.pool.query(
      "INSERT INTO administrative_audit_event (actor_principal_id, action, target_type, target_public_id, reason, request_id, outcome, created_at) VALUES ($1, 'ADMIN_RETENTION_TEST', 'COOKBOOK', $2, 'Retention test', 'retention', 'SUCCEEDED', now() - $3 * interval '24 hours') RETURNING id",
      [administrator.principalId, tenant.publicId, age],
    );
    ids.push(event.rows[0]!.id);
  }
  assert.equal(await pruneAdministrativeAudit(database.pool), 1);
  assert.equal(
    (await database.pool.query('SELECT 1 FROM administrative_audit_event WHERE id = $1', [ids[0]]))
      .rowCount,
    0,
  );
  assert.equal(
    (await database.pool.query('SELECT 1 FROM administrative_audit_event WHERE id = $1', [ids[1]]))
      .rowCount,
    1,
  );
  assert.equal(await pruneAdministrativeAudit(database.pool), 0);
  await setAuditRetentionDays(database.pool, 365);
});

test('audit survives target cookbook, account and principal hard deletion', async (): Promise<void> => {
  const original: number = await countEvents();
  await database.pool.query('DELETE FROM tenant WHERE id = $1', [tenant.id]);
  await database.pool.query('DELETE FROM user_session WHERE user_account_id = $1', [
    administrator.userId,
  ]);
  await database.pool.query('DELETE FROM principal_instance_role WHERE principal_id = $1', [
    administrator.principalId,
  ]);
  await database.pool.query('DELETE FROM oauth_access_token WHERE principal_id = $1', [
    administrator.principalId,
  ]);
  await database.pool.query('DELETE FROM user_account WHERE id = $1', [administrator.userId]);
  await database.pool.query('DELETE FROM principal WHERE id = $1', [administrator.principalId]);
  assert.equal(await countEvents(), original);
  assert.equal(
    (
      await database.pool.query(
        'SELECT DISTINCT actor_principal_id FROM administrative_audit_event',
      )
    ).rows[0].actor_principal_id,
    administrator.principalId,
  );
});
