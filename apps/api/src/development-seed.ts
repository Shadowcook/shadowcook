import type { Pool } from 'pg';
import { loadDevelopmentSeed } from './development-seed-loader.js';

interface IdentifierRow {
  id: string;
}

export async function seedDevelopmentCookbook(
  pool: Pool,
  administratorEmail: string,
  instanceSecretKey: Buffer | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const administratorResult = await client.query<IdentifierRow>(
      'SELECT principal_id AS id FROM user_account WHERE email = $1',
      [administratorEmail.trim().toLowerCase()],
    );
    const administrator: IdentifierRow | undefined = administratorResult.rows[0];
    if (administrator === undefined)
      throw new Error('Development bootstrap administrator does not exist.');
    await loadDevelopmentSeed(client, {
      bootstrapAdministratorPrincipalId: administrator.id,
      instanceSecretKey,
    });
    await grantLocalCookbookOwnerRole(client, administrator.id);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function grantLocalCookbookOwnerRole(
  client: import('pg').PoolClient,
  principalId: string,
): Promise<void> {
  const tenantResult = await client.query<IdentifierRow>(
    "SELECT id FROM tenant WHERE slug = 'local-cookbook'",
  );
  const tenant: IdentifierRow | undefined = tenantResult.rows[0];
  if (tenant === undefined) return;
  await client.query(
    'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [tenant.id, principalId],
  );
  const roleResult = await client.query<IdentifierRow>(
    `INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Owner')
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenant.id],
  );
  const role: IdentifierRow = roleResult.rows[0]!;
  await client.query(
    `INSERT INTO tenant_role_permission (tenant_role_id, permission_code)
     SELECT $1, code FROM permission
     WHERE code LIKE 'tenant:%' OR code LIKE 'recipe:%' OR code LIKE 'variant:%'
       OR code LIKE 'ingredient:%' OR code LIKE 'category:%' OR code = 'service-account:manage'
     ON CONFLICT DO NOTHING`,
    [role.id],
  );
  await client.query(
    `INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenant.id, principalId, role.id],
  );
}
