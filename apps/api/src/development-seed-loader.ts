import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { encryptSecret } from './security/encryption.js';

type JsonScalar = boolean | number | string | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];
interface JsonObject {
  readonly [key: string]: JsonValue;
}
interface SeedContext {
  bootstrapAdministratorPrincipalId: string | null;
  instanceSecretKey: Buffer | null;
}

const identifierPattern: RegExp = /^[a-z][a-z0-9_]*$/;

export async function loadDevelopmentSeed(client: PoolClient, context: SeedContext): Promise<void> {
  const seed: JsonObject = readSeedFile('development-seed.json', false);
  await loadSeed(client, seed, context);
}

export async function loadInitialDeploymentSeed(client: PoolClient): Promise<void> {
  const seed: JsonObject = readSeedFile('initial-deployment-seed.json', true);
  await loadSeed(client, seed, {
    bootstrapAdministratorPrincipalId: null,
    instanceSecretKey: null,
  });
}

async function loadSeed(client: PoolClient, seed: JsonObject, context: SeedContext): Promise<void> {
  for (const [tableName, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows))
      throw new Error(`Seed table '${tableName}' must contain an array of rows.`);
    await assertTableExists(client, tableName);
    const columns: ReadonlySet<string> = await tableColumns(client, tableName);
    for (const row of rows) {
      if (!isJsonObject(row))
        throw new Error(`Seed table '${tableName}' contains a non-object row.`);
      await insertSeedRow(client, tableName, columns, row, context);
    }
  }
}

function readSeedFile(fileName: string, required: boolean): JsonObject {
  const seedFilePath: string = fileURLToPath(new URL(`../../../${fileName}`, import.meta.url));
  if (!existsSync(seedFilePath)) {
    if (required) throw new Error(`Seed file '${fileName}' does not exist.`);
    return {};
  }
  const value: unknown = JSON.parse(readFileSync(seedFilePath, 'utf8'));
  if (!isJsonObject(value))
    throw new Error(
      `Seed file '${fileName}' must contain an object whose keys are database table names.`,
    );
  return value;
}

async function assertTableExists(client: PoolClient, tableName: string): Promise<void> {
  if (!identifierPattern.test(tableName))
    throw new Error(`Invalid seed table name '${tableName}'.`);
  const result = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS exists',
    [tableName],
  );
  if (result.rows[0]?.exists !== true) throw new Error(`Seed table '${tableName}' does not exist.`);
}

async function tableColumns(client: PoolClient, tableName: string): Promise<ReadonlySet<string>> {
  const result = await client.query<{ column_name: string }>(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
    [tableName],
  );
  return new Set<string>(
    result.rows.map((row: { column_name: string }): string => row.column_name),
  );
}

async function insertSeedRow(
  client: PoolClient,
  tableName: string,
  allowedColumns: ReadonlySet<string>,
  row: JsonObject,
  context: SeedContext,
): Promise<void> {
  const columnNames: string[] = Object.keys(row);
  if (columnNames.length === 0) throw new Error(`Seed table '${tableName}' contains an empty row.`);
  for (const columnName of columnNames)
    if (!identifierPattern.test(columnName) || !allowedColumns.has(columnName))
      throw new Error(`Seed column '${tableName}.${columnName}' does not exist.`);
  const values: unknown[] = [];
  for (const columnName of columnNames) values.push(await resolveValue(row[columnName], context));
  const quotedColumns: string = columnNames.map(quoteIdentifier).join(', ');
  const placeholders: string = columnNames
    .map((_columnName: string, index: number): string => `$${index + 1}`)
    .join(', ');
  await client.query(
    `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    values,
  );
}

async function resolveValue(value: JsonValue, context: SeedContext): Promise<unknown> {
  if (!isJsonObject(value)) return value;
  const seedReference: JsonValue | undefined = value.$seedRef;
  if (typeof seedReference === 'string') {
    if (seedReference !== 'bootstrapAdministratorPrincipalId')
      throw new Error(`Unknown seed reference '${seedReference}'.`);
    if (context.bootstrapAdministratorPrincipalId === null)
      throw new Error('The initial deployment seed cannot reference the bootstrap administrator.');
    return context.bootstrapAdministratorPrincipalId;
  }
  const secret: JsonValue | undefined = value.$encrypt;
  if (typeof secret === 'string') {
    if (context.instanceSecretKey === null)
      throw new Error('INSTANCE_SECRET_KEY is required to encrypt a seed value.');
    return encryptSecret(secret, context.instanceSecretKey);
  }
  return value;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
