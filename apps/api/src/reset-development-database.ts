import { closeDatabaseConnection, createDatabaseConnection } from '@shadowcook/db';
import type { DatabaseConnection } from '@shadowcook/db';
import { loadLocalEnvironment } from './environment.js';

async function resetDevelopmentDatabase(): Promise<void> {
  loadLocalEnvironment();
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The development database reset is only available when NODE_ENV=development.');
  }
  const databaseUrl: string | undefined = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL must be configured.');
  }

  const connection: DatabaseConnection = createDatabaseConnection(databaseUrl);
  try {
    await connection.pool.query('DROP SCHEMA public CASCADE');
    await connection.pool.query('CREATE SCHEMA public');
  } finally {
    await closeDatabaseConnection(connection);
  }
}

resetDevelopmentDatabase().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
