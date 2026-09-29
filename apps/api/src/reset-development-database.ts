import { closeDatabaseConnection, createDatabaseConnection } from '@shadowcook/db';
import type { DatabaseConnection } from '@shadowcook/db';
import { loadLocalEnvironment } from './environment.js';

const shadowcookDatabaseName: string = 'shadowcook';

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
    const result: { rows: Array<{ database_name: string }> } = await connection.pool.query(
      'SELECT current_database() AS database_name',
    );
    const databaseName: string | undefined = result.rows[0]?.database_name;
    if (databaseName !== shadowcookDatabaseName) {
      throw new Error(`The database reset is only available for ${shadowcookDatabaseName}.`);
    }

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
