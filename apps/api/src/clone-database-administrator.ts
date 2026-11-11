import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { configureCloneAdministrator } from './development/clone-administrator.js';
import { minimumPasswordEntropy, validatePassword } from './auth/password.js';

async function main(): Promise<void> {
  const databaseUrl: string | undefined = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('The target database URL is missing.');
  }
  const password: string = readFileSync(0, 'utf8').replace(/\n$/u, '');
  const pool: Pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
  try {
    if (process.argv.includes('--validate-password')) {
      if (password.length === 0) throw new Error('The test password must not be empty.');
      validatePassword(password, await minimumPasswordEntropy(pool));
    } else {
      await configureCloneAdministrator(pool, password);
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
