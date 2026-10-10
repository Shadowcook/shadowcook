import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface OwnedCookbook {
  id: string;
  slug: string;
}
export class CookbookLimitError extends Error {}

export async function createOwnedCookbook(
  client: PoolClient,
  principalId: string,
  displayName: string,
  maximumCookbooks: number,
): Promise<OwnedCookbook> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('cookbook-owner:' || $1))", [
    principalId,
  ]);
  const owned = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM tenant WHERE owner_principal_id = $1',
    [principalId],
  );
  if (Number(owned.rows[0]?.count ?? 0) >= maximumCookbooks) throw new CookbookLimitError();
  const baseSlug: string = cookbookSlugBase(displayName);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('tenant-slug:' || $1))", [baseSlug]);
  let slug: string = baseSlug;
  while (true) {
    const existing = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM tenant WHERE slug = $1) AS exists',
      [slug],
    );
    if (existing.rows[0]?.exists !== true) break;
    slug = `${baseSlug}-${randomBytes(4).toString('hex')}`;
  }
  const tenant = await client.query<{ id: string; slug: string }>(
    'INSERT INTO tenant (display_name, slug) VALUES ($1, $2) RETURNING id, slug',
    [displayName, slug],
  );
  const tenantId: string = tenant.rows[0]!.id;
  const owner = await client.query<{ id: string }>(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Owner') RETURNING id",
    [tenantId],
  );
  await client.query(
    "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code NOT LIKE 'instance:%' AND code <> 'tenant:create'",
    [owner.rows[0]!.id],
  );
  const editor = await client.query<{ id: string }>(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Editor') RETURNING id",
    [tenantId],
  );
  await client.query(
    "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'recipe:revision:read', 'recipe:create', 'recipe:update', 'variant:read', 'variant:create', 'variant:update', 'ingredient:read', 'ingredient:create', 'ingredient:update', 'unit:read', 'unit:create', 'unit:update', 'category:read', 'category:update')",
    [editor.rows[0]!.id],
  );
  const viewer = await client.query<{ id: string }>(
    "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Viewer') RETURNING id",
    [tenantId],
  );
  await client.query(
    "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'variant:read', 'ingredient:read', 'unit:read', 'category:read')",
    [viewer.rows[0]!.id],
  );
  await client.query('INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)', [
    tenantId,
    principalId,
  ]);
  await client.query(
    'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
    [tenantId, principalId, owner.rows[0]!.id],
  );
  await client.query('UPDATE tenant SET owner_principal_id = $1 WHERE id = $2', [
    principalId,
    tenantId,
  ]);
  return { id: tenantId, slug: tenant.rows[0]!.slug };
}

export function cookbookSlugBase(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cookbook'
  );
}
