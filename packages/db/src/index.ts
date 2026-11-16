export { closeDatabaseConnection, createDatabaseConnection } from './database.js';
export { migrateDatabase } from './migrate.js';
export { MigrationCompatibilityError } from './migrations/compatibility-error.js';
export type { DatabaseConnection } from './database.js';
export type { Database } from './schema.js';
