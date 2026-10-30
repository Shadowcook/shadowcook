import type { Pool } from 'pg';
import { loadInitialDeploymentSeed } from './development-seed-loader.js';

const seedId: string = 'initial-deployment-units-v1';

export async function seedInitialDeployment(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(
      'INSERT INTO application_seed (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [seedId],
    );
    if (result.rowCount === 1) await loadInitialDeploymentSeed(client);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
