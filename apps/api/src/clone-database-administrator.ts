import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  configureCloneAdministrator,
  validateClonePassword,
} from './development/clone-administrator.js';

async function main(): Promise<void> {
  const databaseUrl: string | undefined = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('The target database URL is missing.');
  }
  const password: string = readFileSync(0, 'utf8').replace(/\n$/u, '');
  validateClonePassword(password);
  if (process.argv.includes('--validate-password')) return;
  const pool: Pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 15_000,
    options: '-c search_path=public,pg_catalog',
  });
  try {
    const administratorReady: boolean = await configureCloneAdministrator(pool, password);
    if (!administratorReady) {
      console.error(
        'Local admin@local setup skipped: the copied schema has no compatible administrator model. Existing user passwords are updated where supported.',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown): void => {
  const message: string = error instanceof Error ? error.message : 'Administrator setup failed.';
  console.error(message);
  process.exitCode = 1;
});
