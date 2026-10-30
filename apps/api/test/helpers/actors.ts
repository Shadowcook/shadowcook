import type { Pool } from 'pg';
import { hashPassword } from '../../src/auth/password.js';

export interface TestUser {
  userId: string;
  principalId: string;
  email: string;
  password: string;
}

export interface CreateTestUserOptions {
  email: string;
  passwordChangeRequired?: boolean;
  disabled?: boolean;
}

export interface TestTenant {
  id: string;
  publicId: string;
  slug: string;
}

export interface TestCategory {
  publicId: string;
}

export async function createTestUser(
  pool: Pool,
  options: CreateTestUserOptions,
): Promise<TestUser> {
  const password: string = 'eR7!vQ2#nL9@xC4$kM8%pT6&zA1*';
  const passwordHash: string = await hashPassword(password, 60);
  const principalResult = await pool.query<{ id: string }>(
    "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
  );
  const principalId: string = requiredRow(principalResult.rows[0], 'principal').id;
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO user_account
      (principal_id, email, display_name, password_hash, password_change_required, disabled_at)
     VALUES ($1, $2, 'Test user', $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      principalId,
      options.email,
      passwordHash,
      options.passwordChangeRequired ?? false,
      options.disabled ?? false,
    ],
  );

  return {
    userId: requiredRow(userResult.rows[0], 'user account').id,
    principalId,
    email: options.email,
    password,
  };
}

export async function assignTenantRole(
  pool: Pool,
  principalId: string,
  tenantSlug: string,
  permissions: readonly string[] = ['recipe:read'],
): Promise<TestTenant> {
  const tenant: TestTenant = await createTestTenant(pool, tenantSlug);
  const roleResult = await pool.query<{ id: string }>(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Test role') RETURNING id",
    [tenant.id],
  );
  const roleId: string = requiredRow(roleResult.rows[0], 'tenant role').id;
  for (const permissionCode of permissions) {
    await pool.query(
      'INSERT INTO tenant_role_permission (tenant_role_id, permission_code) VALUES ($1, $2)',
      [roleId, permissionCode],
    );
  }
  await pool.query('INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)', [
    tenant.id,
    principalId,
  ]);
  await pool.query(
    'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
    [tenant.id, principalId, roleId],
  );
  return tenant;
}

export async function createTestTenant(pool: Pool, slug: string): Promise<TestTenant> {
  const result = await pool.query<{ id: string; public_id: string; slug: string }>(
    "INSERT INTO tenant (display_name, slug) VALUES ('Test tenant', $1) RETURNING id, public_id, slug",
    [slug],
  );
  const tenant = requiredRow(result.rows[0], 'tenant');
  return { id: tenant.id, publicId: tenant.public_id, slug: tenant.slug };
}

export async function createTestCategory(
  pool: Pool,
  tenantId: string,
  name: string,
  slug: string,
): Promise<TestCategory> {
  const result = await pool.query<{ public_id: string }>(
    `INSERT INTO category (tenant_id, name, slug, sort_order)
     VALUES ($1, $2, $3, 0)
     RETURNING public_id`,
    [tenantId, name, slug],
  );
  return { publicId: requiredRow(result.rows[0], 'category').public_id };
}

function requiredRow<Row>(row: Row | undefined, name: string): Row {
  if (row === undefined) throw new Error(`Test fixture did not create a ${name}.`);
  return row;
}
