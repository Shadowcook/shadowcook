import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSqlMigration } from './load-sql-migration.js';
import type { Migration } from './types.js';

const migrationDirectoryUrl: URL = new URL('./sql/', import.meta.url);
const sqlFileExtension: string = '.sql';

export function discoverSqlMigrations(): readonly Migration[] {
  const migrationDirectoryPath: string = fileURLToPath(migrationDirectoryUrl);
  const migrationFileNames: readonly string[] = readdirSync(migrationDirectoryPath)
    .filter((fileName: string): boolean => fileName.endsWith(sqlFileExtension))
    .sort();

  return migrationFileNames.map((fileName: string): Migration => {
    const migrationId: string = fileName.slice(0, -sqlFileExtension.length);
    const migrationUrl: URL = new URL(fileName, migrationDirectoryUrl);

    return loadSqlMigration(migrationId, migrationUrl);
  });
}
