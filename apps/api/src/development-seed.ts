import type { Pool } from 'pg';
import { loadDevelopmentContentSeed, loadDevelopmentSeed } from './development-seed-loader.js';

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
      'SELECT principal_id AS id FROM user_account WHERE email = $1 AND deleted_at IS NULL',
      [administratorEmail.trim().toLowerCase()],
    );
    const administrator: IdentifierRow | undefined = administratorResult.rows[0];
    if (administrator === undefined)
      throw new Error('Development bootstrap administrator does not exist.');
    await loadDevelopmentSeed(client, {
      bootstrapAdministratorPrincipalId: administrator.id,
      instanceSecretKey,
      allowDevelopmentPasswordHashes: true,
    });
    await loadDevelopmentContentSeed(client, {
      bootstrapAdministratorPrincipalId: administrator.id,
      instanceSecretKey,
      allowDevelopmentPasswordHashes: true,
    });
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
