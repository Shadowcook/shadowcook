import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import { createTestApi } from '../helpers/api.js';
import { createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

let database: DisposablePostgresDatabase;
let api: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let ownerCookie: string;
let memberCookie: string;
let ownerPublicId: string;
let memberPublicId: string;
let tenantId: string;
let otherTenantId: string;
let editorRoleId: string;
let invitationMail: string = '';
const tenantSlug: string = 'removal-kitchen';

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  owner = await createTestUser(database.pool, { email: 'removal-owner@example.test' });
  member = await createTestUser(database.pool, { email: 'removal-member@example.test' });
  ownerCookie = await loginCookie(owner);
  memberCookie = await loginCookie(member);
  await database.pool.query(
    'INSERT INTO instance_registration_settings (max_cookbooks_per_owner) VALUES (2) ON CONFLICT (singleton) DO UPDATE SET max_cookbooks_per_owner = 2',
  );
  for (const cookbookName of ['Removal Kitchen', 'Other Kitchen']) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/account/cookbooks',
      headers: { cookie: ownerCookie },
      payload: { cookbookName },
    });
    assert.equal(response.statusCode, 201, response.body);
  }
  const roles: QueryResult<{ id: string; tenant_id: string; slug: string }> =
    await database.pool.query(
      `SELECT tenant_role.id, tenant_role.tenant_id, tenant.slug FROM tenant_role
     INNER JOIN tenant ON tenant.id = tenant_role.tenant_id WHERE tenant_role.name = 'Editor'`,
    );
  for (const role of roles.rows) {
    await database.pool.query(
      'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
      [role.tenant_id, member.principalId],
    );
    await database.pool.query(
      'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
      [role.tenant_id, member.principalId, role.id],
    );
    if (role.slug === tenantSlug) {
      tenantId = role.tenant_id;
      editorRoleId = role.id;
    } else {
      otherTenantId = role.tenant_id;
    }
  }
  const users: QueryResult<{ public_id: string; id: string }> = await database.pool.query(
    'SELECT public_id, id FROM user_account',
  );
  ownerPublicId = users.rows.find(
    (user: { id: string }): boolean => user.id === owner.userId,
  )!.public_id;
  memberPublicId = users.rows.find(
    (user: { id: string }): boolean => user.id === member.userId,
  )!.public_id;
  await database.pool.query(
    `INSERT INTO instance_mail_settings (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id)
     VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)`,
    [owner.principalId],
  );
  mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: { text: string }): Promise<void> => {
      invitationMail = mail.text;
    },
  }));
});

after(async (): Promise<void> => {
  mock.restoreAll();
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('removal requires authentication, tenant management permission and a non-owner member', async (): Promise<void> => {
  const anonymous: LightMyRequestResponse = await remove(memberPublicId);
  assert.equal(anonymous.statusCode, 401);
  const forbidden: LightMyRequestResponse = await remove(ownerPublicId, memberCookie);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json<{ code: string }>().code, 'TENANT_PERMISSION_REQUIRED');
  const protectedOwner: LightMyRequestResponse = await remove(ownerPublicId, ownerCookie);
  assert.equal(protectedOwner.statusCode, 403);
  assert.equal(protectedOwner.json<{ code: string }>().code, 'OWNER_MEMBERSHIP_PROTECTED');
  const invalid: LightMyRequestResponse = await remove('invalid', ownerCookie);
  assert.equal(invalid.statusCode, 400);
});

test('a user outside the selected cookbook cannot be removed', async (): Promise<void> => {
  const outsider: TestUser = await createTestUser(database.pool, {
    email: 'removal-outsider@example.test',
  });
  const user: QueryResult<{ public_id: string }> = await database.pool.query(
    'SELECT public_id FROM user_account WHERE id = $1',
    [outsider.userId],
  );
  await database.pool.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
    [otherTenantId, outsider.principalId],
  );
  const response: LightMyRequestResponse = await remove(user.rows[0]!.public_id, ownerCookie);
  assert.equal(response.statusCode, 404);
  const membership: QueryResult = await database.pool.query(
    'SELECT 1 FROM tenant_membership WHERE tenant_id = $1 AND principal_id = $2',
    [otherTenantId, outsider.principalId],
  );
  assert.equal(membership.rowCount, 1);
});

test('removal revokes only cookbook access, preserves contributions and supports rejoining by invitation', async (): Promise<void> => {
  const recipe: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenants/${tenantSlug}/recipes`,
    headers: { cookie: memberCookie },
    payload: {
      title: 'Retained recipe',
      slug: 'retained-recipe',
      summary: null,
      categoryPublicIds: [],
      visibilityOverride: null,
      discoverabilityOverride: null,
      isFeatured: false,
    },
  });
  assert.equal(recipe.statusCode, 201, recipe.body);
  const response: LightMyRequestResponse = await remove(memberPublicId, ownerCookie);
  assert.equal(response.statusCode, 204, response.body);
  assert.equal(response.body, '');
  for (const table of ['tenant_membership', 'tenant_membership_role']) {
    const result: QueryResult<{ tenant_id: string }> = await database.pool.query(
      `SELECT tenant_id FROM ${table} WHERE principal_id = $1`,
      [member.principalId],
    );
    assert.deepEqual(result.rows, [{ tenant_id: otherTenantId }]);
  }
  const retained: QueryResult = await database.pool.query(
    `SELECT 1 FROM recipe_revision INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
     INNER JOIN recipe_revision_contributor ON recipe_revision_contributor.recipe_revision_id = recipe_revision.id
     WHERE recipe.public_id = $1 AND recipe_revision.created_by_principal_id = $2
       AND recipe_revision_contributor.principal_id = $2`,
    [recipe.json<{ publicId: string }>().publicId, member.principalId],
  );
  assert.equal(retained.rowCount, 1);
  const access: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/cookbook/tenants/${tenantSlug}/drafts`,
    headers: { cookie: memberCookie },
  });
  assert.equal(access.statusCode, 403);
  const repeated: LightMyRequestResponse = await remove(memberPublicId, ownerCookie);
  assert.equal(repeated.statusCode, 404);
  const invitation: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/cookbook/tenant-users/invitations?tenantSlug=${tenantSlug}`,
    headers: { cookie: ownerCookie },
    payload: { email: member.email, roleId: editorRoleId },
  });
  assert.equal(invitation.statusCode, 201, invitation.body);
  const token: string | undefined = invitationMail.match(
    /\/user-invitations\/([A-Za-z0-9_-]+)/,
  )?.[1];
  assert.ok(token);
  const accepted: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: `/user-invitations/${token}/accept`,
    headers: { cookie: memberCookie },
    payload: {},
  });
  assert.equal(accepted.statusCode, 204, accepted.body);
  const restored: QueryResult<{ tenant_role_id: string }> = await database.pool.query(
    'SELECT tenant_role_id FROM tenant_membership_role WHERE tenant_id = $1 AND principal_id = $2',
    [tenantId, member.principalId],
  );
  assert.deepEqual(restored.rows, [{ tenant_role_id: editorRoleId }]);
});

function remove(publicId: string, cookie?: string): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'DELETE',
    url: `/cookbook/tenant-users/${publicId}?tenantSlug=${tenantSlug}`,
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function loginCookie(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie: string | string[] | undefined = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return cookie as string;
}
