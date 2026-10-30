import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

export interface DatabaseConnection {
  database: Kysely<Database>;
  pool: Pool;
}

export function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const pool: Pool = new Pool({ connectionString: databaseUrl });
  const database: Kysely<Database> = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return { database, pool };
}

export async function closeDatabaseConnection(connection: DatabaseConnection): Promise<void> {
  await connection.database.destroy();
}
