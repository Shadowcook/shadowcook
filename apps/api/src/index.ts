import { closeDatabaseConnection, createDatabaseConnection, migrateDatabase } from '@shadowcook/db';
import type { DatabaseConnection } from '@shadowcook/db';
import type { FastifyInstance } from 'fastify';
import { bootstrapAdministrator } from './auth/bootstrap.js';
import { createApi } from './app.js';
import { loadApiConfig } from './config.js';
import { seedDevelopmentCookbook } from './development-seed.js';
import { loadLocalEnvironment } from './environment.js';
import { seedInitialDeployment } from './initial-deployment-seed.js';

async function start(): Promise<void> {
  loadLocalEnvironment();
  const config = loadApiConfig(process.env);
  const connection: DatabaseConnection = createDatabaseConnection(config.databaseUrl);

  try {
    await migrateDatabase(connection.pool);
    await seedInitialDeployment(connection.pool);
    const bootstrapResult = await bootstrapAdministrator(connection.pool, {
      email: config.bootstrapAdminEmail,
      password: config.bootstrapAdminPassword,
      passwordChangeRequired: config.bootstrapPasswordChangeRequired,
    });
    if (process.env.NODE_ENV === 'development') {
      await seedDevelopmentCookbook(
        connection.pool,
        config.bootstrapAdminEmail,
        config.instanceSecretKey,
      );
    }
    if (bootstrapResult.created) {
      console.warn(
        `Bootstrap administrator created: email=${bootstrapResult.email} password=${bootstrapResult.password}`,
      );
    }
  } catch (error: unknown) {
    await closeDatabaseConnection(connection);
    throw error;
  }

  const api: FastifyInstance = createApi(
    connection.pool,
    config.secureCookies,
    config.instanceSecretKey,
    config.publicWebOrigin,
    config.publicApiOrigin,
  );
  api.addHook('onClose', async () => {
    await closeDatabaseConnection(connection);
  });

  await api.listen({ host: config.host, port: config.port });
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
