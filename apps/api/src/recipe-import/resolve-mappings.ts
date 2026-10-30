import type { PoolClient, QueryResult } from 'pg';
import { localIngredient, localUnit, type LocalEntity } from './catalogue.js';
import { equivalentConversion } from './matching.js';
import { requiredImportEntities } from './required-entities.js';
import { addImportedIngredientAlias } from './ingredient-alias.js';
import type {
  EntityMapping,
  ImportPermissions,
  PortableIngredient,
  PortableRecipeDocument,
  PortableUnit,
} from './types.js';

export class ImportConflict extends Error {
  public constructor(
    public readonly code:
      | 'IMPORT_MAPPING_INVALID'
      | 'IMPORT_CATALOGUE_CONFLICT'
      | 'IMPORT_UNIT_MISMATCH'
      | 'IMPORT_CREATE_PERMISSION_REQUIRED'
      | 'IMPORT_ALIAS_PERMISSION_REQUIRED'
      | 'INVALID_RECIPE_CATEGORY',
  ) {
    super(code);
  }
}

export interface ResolvedMappings {
  ingredients: Map<string, LocalEntity>;
  units: Map<string, LocalEntity>;
}

function assertMappingKeys(sources: { key: string }[], mappings: EntityMapping[]): void {
  const keys: Set<string> = new Set(mappings.map((mapping: EntityMapping): string => mapping.key));
  if (
    keys.size !== mappings.length ||
    keys.size !== sources.length ||
    sources.some((source): boolean => !keys.has(source.key))
  )
    throw new ImportConflict('IMPORT_MAPPING_INVALID');
}

async function createIngredient(
  client: PoolClient,
  tenantId: string,
  source: PortableIngredient,
  name: string,
): Promise<LocalEntity> {
  const names: string[] = [
    ...new Set([
      name.trim(),
      ...(source.aliases ?? []).map((alias: string): string => alias.trim()),
    ]),
  ];
  const conflict: QueryResult = await client.query(
    `SELECT 1 FROM ingredient LEFT JOIN ingredient_alias ON ingredient_alias.ingredient_id = ingredient.id
     WHERE ingredient.owner_tenant_id = $1 AND (lower(ingredient.canonical_name) = lower($2) OR lower(ingredient_alias.alias) = lower($2)) LIMIT 1`,
    [tenantId, name.trim()],
  );
  if (conflict.rowCount !== 0) throw new ImportConflict('IMPORT_CATALOGUE_CONFLICT');
  const created: QueryResult<LocalEntity> = await client.query<LocalEntity>(
    'INSERT INTO ingredient (owner_tenant_id, canonical_name) VALUES ($1, $2) RETURNING id, public_id, canonical_name AS name',
    [tenantId, name.trim()],
  );
  const entity: LocalEntity = { ...created.rows[0]!, aliases: [] };
  for (const alias of names.slice(1)) {
    const result: QueryResult<{ id: string; name: string }> = await client.query(
      'INSERT INTO ingredient_alias (ingredient_id, alias) VALUES ($1, $2) RETURNING id, alias AS name',
      [entity.id, alias],
    );
    entity.aliases!.push(result.rows[0]!);
  }
  return entity;
}

async function createUnit(
  client: PoolClient,
  tenantId: string,
  source: PortableUnit,
  name: string,
  symbol: string,
): Promise<LocalEntity> {
  const conflict: QueryResult = await client.query(
    'SELECT 1 FROM unit WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1) AND (lower(name) = lower($2) OR lower(symbol) = lower($3)) LIMIT 1',
    [tenantId, name.trim(), symbol.trim()],
  );
  if (conflict.rowCount !== 0) throw new ImportConflict('IMPORT_CATALOGUE_CONFLICT');
  const created: QueryResult<LocalEntity> = await client.query<LocalEntity>(
    `INSERT INTO unit (owner_tenant_id, name, symbol, dimension, base_factor, base_offset)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, public_id, name`,
    [
      tenantId,
      name.trim(),
      symbol.trim(),
      source.conversion?.dimension ?? null,
      source.conversion?.baseFactor ?? null,
      source.conversion?.baseOffset ?? null,
    ],
  );
  return created.rows[0]!;
}

export async function resolveImportMappings(
  client: PoolClient,
  tenantId: string,
  document: PortableRecipeDocument,
  ingredientMappings: EntityMapping[],
  unitMappings: EntityMapping[],
  permissions: ImportPermissions,
): Promise<ResolvedMappings> {
  const required: { ingredients: PortableIngredient[]; units: PortableUnit[] } =
    requiredImportEntities(document);
  assertMappingKeys(required.ingredients, ingredientMappings);
  assertMappingKeys(required.units, unitMappings);
  // Catalogue creation in this cookbook is serialized with other imports.
  await client.query('SELECT id FROM tenant WHERE id = $1 FOR UPDATE', [tenantId]);
  const ingredients: Map<string, LocalEntity> = new Map();
  for (const source of required.ingredients) {
    const mapping: EntityMapping = ingredientMappings.find(
      (item: EntityMapping): boolean => item.key === source.key,
    )!;
    if (mapping.action === 'CREATE' && !permissions.canCreateIngredients)
      throw new ImportConflict('IMPORT_CREATE_PERMISSION_REQUIRED');
    const entity: LocalEntity | null =
      mapping.action === 'EXISTING'
        ? await localIngredient(client, tenantId, mapping.publicId)
        : await createIngredient(client, tenantId, source, mapping.name);
    if (entity === null) throw new ImportConflict('IMPORT_MAPPING_INVALID');
    if (mapping.action === 'EXISTING' && mapping.addAsAlias === true) {
      if (!permissions.canAddIngredientAliases)
        throw new ImportConflict('IMPORT_ALIAS_PERMISSION_REQUIRED');
      await addImportedIngredientAlias(client, entity, source.name);
    }
    ingredients.set(source.key, entity);
  }
  const units: Map<string, LocalEntity> = new Map();
  for (const source of required.units) {
    const mapping: EntityMapping = unitMappings.find(
      (item: EntityMapping): boolean => item.key === source.key,
    )!;
    if (mapping.action === 'CREATE' && !permissions.canCreateUnits)
      throw new ImportConflict('IMPORT_CREATE_PERMISSION_REQUIRED');
    if (
      mapping.action === 'CREATE' &&
      (mapping.symbol === undefined || mapping.symbol.trim().length === 0)
    )
      throw new ImportConflict('IMPORT_MAPPING_INVALID');
    const entity: LocalEntity | null =
      mapping.action === 'EXISTING'
        ? await localUnit(client, tenantId, mapping.publicId)
        : await createUnit(client, tenantId, source, mapping.name, mapping.symbol!);
    if (entity === null) throw new ImportConflict('IMPORT_MAPPING_INVALID');
    if (
      mapping.action === 'EXISTING' &&
      source.conversion !== undefined &&
      !equivalentConversion(source.conversion, entity.conversion ?? null)
    )
      throw new ImportConflict('IMPORT_UNIT_MISMATCH');
    units.set(source.key, entity);
  }
  return { ingredients, units };
}
