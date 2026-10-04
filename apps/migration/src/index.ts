import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type {
  LegacyCookbook,
  MigrationOptions,
  MigrationSummary,
} from './legacy-cookbook-migration/model.js';
import { readLegacyCookbook, resolveHsqldbJar } from './legacy-cookbook-migration/source.js';
import { migrateCookbook } from './legacy-cookbook-migration/target.js';

function loadEnvironment(): void {
  const projectRoot: URL = new URL('../../../', import.meta.url);
  const path: string = fileURLToPath(new URL('.env.migration', projectRoot));
  if (existsSync(path)) process.loadEnvFile(path);
}

function requiredEnvironment(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim().length === 0)
    throw new Error(`${name} must be configured before running the migration.`);
  return value.trim();
}

function optionalEnvironment(name: string): string | null {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim().length === 0) return null;
  return value.trim();
}

function parseExecuteArgument(arguments_: string[]): boolean {
  const unsupported: string[] = arguments_.filter(
    (argument: string): boolean => argument !== '--execute',
  );
  if (unsupported.length > 0)
    throw new Error(
      `Unsupported migration argument '${unsupported[0]}'. Only --execute is accepted.`,
    );
  return arguments_.includes('--execute');
}

function printSummary(summary: MigrationSummary, executed: boolean): void {
  const mode: string = executed ? 'committed' : 'validated and rolled back';
  process.stdout.write(
    [
      `Legacy cookbook migration ${mode}.`,
      `Categories: ${summary.categories}`,
      `Recipes: ${summary.recipes}`,
      `Steps: ${summary.steps}`,
      `Ingredient and special entries: ${summary.ingredientUsages}`,
      `Tenant units created: ${summary.tenantUnitsCreated}`,
      `Empty instructions represented by an em dash: ${summary.substitutedEmptyInstructions}`,
      `Empty special-entry labels represented by their legacy unit label: ${summary.substitutedEmptySpecialEntryLabels}`,
      `Thumbnail references skipped because media storage is not implemented: ${summary.skippedThumbnailReferences}`,
    ].join('\n') + '\n',
  );
}

async function main(): Promise<void> {
  loadEnvironment();
  const execute: boolean = parseExecuteArgument(process.argv.slice(2));
  requiredEnvironment('SOURCE_DB_URL');
  requiredEnvironment('SOURCE_DB_USERNAME');
  requiredEnvironment('SOURCE_DB_PASSWORD');
  const databaseUrl: string = requiredEnvironment('TARGET_DB_URL');
  const databaseUsername: string = requiredEnvironment('TARGET_DB_USERNAME');
  const databasePassword: string = requiredEnvironment('TARGET_DB_PASSWORD');
  const options: MigrationOptions = {
    execute,
    tenantSlug: requiredEnvironment('TARGET_DB_TENANT_SLUG'),
    authorPrincipalId: optionalEnvironment('TARGET_DB_AUTHOR_PRINCIPAL_ID'),
    hsqldbJarPath: resolveHsqldbJar(process.env.SOURCE_DB_HSQLDB_JAR),
  };

  const cookbook: LegacyCookbook = await readLegacyCookbook(options.hsqldbJarPath);
  const pool: Pool = new Pool({
    connectionString: databaseUrl,
    user: databaseUsername,
    password: databasePassword,
    max: 1,
  });
  try {
    const summary: MigrationSummary = await migrateCookbook(pool, cookbook, options);
    printSummary(summary, execute);
    if (!execute)
      process.stdout.write(
        'Run the same command with --execute only after reviewing this dry run.\n',
      );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown): void => {
  const message: string = error instanceof Error ? error.message : 'Unknown migration failure.';
  process.stderr.write(`Legacy cookbook migration failed: ${message}\n`);
  process.exitCode = 1;
});
