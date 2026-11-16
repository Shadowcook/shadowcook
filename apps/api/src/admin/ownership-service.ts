import type { PoolClient, QueryResult } from 'pg';
import type { AdministrativeResult } from './audit-operation.js';
import { ownershipError, type OwnershipInput } from './ownership-input.js';

export interface OwnershipTransfer {
  cookbookPublicId: string;
  oldOwnerPublicId: string | null;
  newOwnerPublicId: string;
  formerOwnerRole: string;
  notifications: { recipient: 'OLD_OWNER' | 'NEW_OWNER'; email: string }[];
  cookbookName: string;
  cookbookSlug: string;
}
interface OwnerRow {
  id: string;
  owner_principal_id: string | null;
  display_name: string;
  slug: string;
}
interface AccountRow {
  principal_id: string;
  public_id: string;
  email: string;
}
const editorPermissions: readonly string[] = [
  'recipe:read',
  'recipe:revision:read',
  'recipe:create',
  'recipe:update',
  'variant:read',
  'variant:create',
  'variant:update',
  'ingredient:read',
  'ingredient:create',
  'ingredient:update',
  'unit:read',
  'unit:create',
  'unit:update',
  'category:read',
  'category:update',
];
const viewerPermissions: readonly string[] = [
  'recipe:read',
  'variant:read',
  'ingredient:read',
  'unit:read',
  'category:read',
];

async function roleForTransfer(
  client: PoolClient,
  tenantId: string,
  name: string,
): Promise<string> {
  const permissions: QueryResult<{ code: string }> = await client.query(
    "SELECT code FROM permission WHERE code NOT LIKE 'instance:%' AND code <> 'tenant:create'",
  );
  const expected: readonly string[] =
    name === 'Owner'
      ? permissions.rows.map((row: { code: string }): string => row.code)
      : name === 'Editor'
        ? editorPermissions
        : viewerPermissions;
  const role: QueryResult<{ id: string }> = await client.query(
    'SELECT id FROM tenant_role WHERE tenant_id = $1 AND name = $2 FOR UPDATE',
    [tenantId, name],
  );
  if (!role.rows[0]) {
    const created: QueryResult<{ id: string }> = await client.query(
      'INSERT INTO tenant_role (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [tenantId, name],
    );
    await client.query(
      'INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, unnest($2::text[])',
      [created.rows[0]!.id, expected],
    );
    return created.rows[0]!.id;
  }
  const actual: QueryResult<{ permission_code: string }> = await client.query(
    'SELECT permission_code FROM tenant_role_permission WHERE tenant_role_id = $1',
    [role.rows[0].id],
  );
  if (
    actual.rows.length !== expected.length ||
    actual.rows.some(
      (row: { permission_code: string }): boolean => !expected.includes(row.permission_code),
    )
  )
    ownershipError(409, 'OWNERSHIP_ROLE_CONFLICT');
  return role.rows[0].id;
}

export async function transferOwnership(
  client: PoolClient,
  publicId: string,
  input: OwnershipInput,
): Promise<AdministrativeResult<OwnershipTransfer>> {
  const tenantResult: QueryResult<OwnerRow> = await client.query(
    'SELECT id, owner_principal_id, display_name, slug FROM tenant WHERE public_id = $1 FOR UPDATE',
    [publicId],
  );
  const tenant: OwnerRow | undefined = tenantResult.rows[0];
  if (!tenant) ownershipError(404, 'TENANT_NOT_FOUND');
  const previous: QueryResult<AccountRow> = await client.query(
    'SELECT principal_id, public_id, email FROM user_account WHERE principal_id = $1',
    [tenant.owner_principal_id],
  );
  const old: AccountRow | undefined = previous.rows[0];
  if ((old?.public_id ?? null) !== input.expectedOwnerPublicId)
    ownershipError(409, 'OWNERSHIP_CHANGED');
  if (tenant.owner_principal_id !== null && !old) ownershipError(409, 'OWNERSHIP_ROLE_CONFLICT');
  const recipient: QueryResult<AccountRow> = await client.query(
    `SELECT p.id AS principal_id, u.public_id, u.email FROM user_account u JOIN principal p ON p.id = u.principal_id
    WHERE u.public_id = $1 AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND p.disabled_at IS NULL AND p.principal_type = 'USER' FOR SHARE OF u, p`,
    [input.recipientPublicId],
  );
  const next: AccountRow | undefined = recipient.rows[0];
  if (!next || next.principal_id === tenant.owner_principal_id)
    ownershipError(400, 'INVALID_OWNERSHIP_RECIPIENT');
  const ownerRole: string = await roleForTransfer(client, tenant.id, 'Owner');
  const retainedRole: string | null =
    old && input.formerOwnerRole !== 'REMOVE'
      ? await roleForTransfer(client, tenant.id, input.formerOwnerRole)
      : null;
  const otherOwners: QueryResult = await client.query(
    `SELECT 1 FROM tenant_membership_role WHERE tenant_id = $1 AND tenant_role_id = $2 AND principal_id <> $3 AND ($4::uuid IS NULL OR principal_id <> $4)`,
    [tenant.id, ownerRole, next.principal_id, tenant.owner_principal_id],
  );
  if (otherOwners.rowCount !== 0) ownershipError(409, 'OWNERSHIP_ROLE_CONFLICT');
  await client.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [tenant.id, next.principal_id],
  );
  await client.query(
    'DELETE FROM tenant_membership_role WHERE tenant_id = $1 AND principal_id = $2',
    [tenant.id, next.principal_id],
  );
  await client.query(
    'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
    [tenant.id, next.principal_id, ownerRole],
  );
  await client.query(
    'UPDATE tenant SET owner_principal_id = $1, updated_at = now() WHERE id = $2',
    [next.principal_id, tenant.id],
  );
  if (old) {
    await client.query(
      'DELETE FROM tenant_membership_role WHERE tenant_id = $1 AND principal_id = $2',
      [tenant.id, old.principal_id],
    );
    if (retainedRole)
      await client.query(
        'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
        [tenant.id, old.principal_id, retainedRole],
      );
    else
      await client.query(
        'DELETE FROM tenant_membership WHERE tenant_id = $1 AND principal_id = $2',
        [tenant.id, old.principal_id],
      );
  }
  await client.query(
    'DELETE FROM tenant_invitation WHERE tenant_id = $1 AND tenant_role_id = $2 AND accepted_at IS NULL',
    [tenant.id, ownerRole],
  );
  return {
    value: {
      cookbookPublicId: publicId,
      oldOwnerPublicId: old?.public_id ?? null,
      newOwnerPublicId: next.public_id,
      formerOwnerRole: old ? input.formerOwnerRole : 'REMOVE',
      cookbookName: tenant.display_name,
      cookbookSlug: tenant.slug,
      notifications: [
        ...(old ? [{ recipient: 'OLD_OWNER' as const, email: old.email }] : []),
        { recipient: 'NEW_OWNER', email: next.email },
      ],
    },
    previousState: old ? { ownerPrincipalId: old.principal_id } : { status: 'UNCLAIMED' },
    newState: {
      ownerPrincipalId: next.principal_id,
      membershipRetained: retainedRole !== null,
      roleCode: old ? input.formerOwnerRole : 'REMOVE',
    },
  };
}
