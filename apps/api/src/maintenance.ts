import { closeDatabaseConnection, createDatabaseConnection, migrateDatabase } from '@shadowcook/db';
import type { DatabaseConnection } from '@shadowcook/db';
import { hashPassword } from './auth/password.js';

interface ResetPasswordArguments {
  email: string;
  password: string;
}

async function main(): Promise<void> {
  const argumentsValue: ResetPasswordArguments = parseResetPasswordArguments(
    process.argv.slice(2),
    process.env,
  );
  const databaseUrl: string | undefined = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL must be configured.');
  }
  const connection: DatabaseConnection = createDatabaseConnection(databaseUrl);
  try {
    await migrateDatabase(connection.pool);
    const passwordHash: string = await hashPassword(argumentsValue.password);
    const result = await connection.pool.query(
      `UPDATE user_account
       SET password_hash = $1, password_change_required = true, password_changed_at = NULL, updated_at = now()
       WHERE email = $2 AND disabled_at IS NULL`,
      [passwordHash, argumentsValue.email],
    );
    if (result.rowCount !== 1)
      throw new Error(`No active user exists for '${argumentsValue.email}'.`);
    await connection.pool.query(
      `UPDATE user_session SET revoked_at = now()
       WHERE user_account_id = (SELECT id FROM user_account WHERE email = $1 AND deleted_at IS NULL) AND revoked_at IS NULL`,
      [argumentsValue.email],
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

function parseResetPasswordArguments(
  argumentsList: string[],
  environment: NodeJS.ProcessEnv,
): ResetPasswordArguments {
  if (argumentsList.length !== 2 || argumentsList[0] !== 'reset-password') {
    throw new Error(
      'Usage: maintenance reset-password <email>; set NEW_PASSWORD in the environment.',
    );
  }
  const password: string | undefined = environment.NEW_PASSWORD;
  if (password === undefined) throw new Error('NEW_PASSWORD must be configured.');
  const email: string = argumentsList[1].trim().toLowerCase();
  if (email.length === 0) throw new Error('Email must not be empty.');
  return { email, password };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
