import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';

export const developmentBaselineSeedId: string = 'development-baseline-v1';

const developmentBaselineSql: string = readFileSync(
  new URL('./development-baseline.sql', import.meta.url),
  'utf8',
);

export async function applyDevelopmentBaselineSeed(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  try {
    const result = await client.query<{ id: string }>(
      'INSERT INTO application_seed (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [developmentBaselineSeedId],
    );
    if (result.rowCount === 1) {
      const existingDataResult = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM tenant) AS exists',
      );
      if (existingDataResult.rows[0]?.exists !== true) {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await client.query(developmentBaselineSql);
      }
    }
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}
