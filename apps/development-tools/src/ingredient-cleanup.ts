import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonScalar = boolean | number | string | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface IngredientRow extends JsonObject {
  id: string;
  public_id: string;
  canonical_name: string;
}

interface IngredientAliasRow extends JsonObject {
  ingredient_id: string;
  alias: string;
}

interface IngredientUsageRow extends JsonObject {
  ingredient_id: string | null;
  note: string | null;
}

interface CleanupRow {
  readonly ingredientName: string;
  readonly newIngredientName: string;
  readonly modifier: string;
  readonly aliasTargetName: string;
}

interface IngredientCleanupSeed extends JsonObject {
  ingredient: IngredientRow[];
  ingredient_alias: IngredientAliasRow[];
  ingredient_usage: IngredientUsageRow[];
}

export const cleanupHeaders: readonly string[] = [
  'Zutat',
  'Neuer Zutat-Name',
  'Zusaetzlicher Modifier',
  'Alias',
];

function projectRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

export function seedFilePath(): string {
  return resolve(
    projectRoot(),
    process.env.DEVELOPMENT_CONTENT_SEED_PATH ?? 'development-content-seed.json',
  );
}

export function cleanupFilePath(): string {
  return resolve(
    projectRoot(),
    process.env.INGREDIENT_CLEANUP_CSV_PATH ?? 'ingredient-cleanup.csv',
  );
}

export function readCleanupSeed(path: string): IngredientCleanupSeed {
  if (!existsSync(path)) throw new Error(`Development content seed '${path}' does not exist.`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isJsonObject(parsed)) throw new Error('Development content seed must be a JSON object.');
  const ingredient: IngredientRow[] = requiredRows(parsed, 'ingredient', isIngredientRow);
  const ingredientAlias: IngredientAliasRow[] = requiredRows(
    parsed,
    'ingredient_alias',
    isIngredientAliasRow,
  );
  const ingredientUsage: IngredientUsageRow[] = requiredRows(
    parsed,
    'ingredient_usage',
    isIngredientUsageRow,
  );
  return {
    ...parsed,
    ingredient,
    ingredient_alias: ingredientAlias,
    ingredient_usage: ingredientUsage,
  };
}

export function writeCleanupCsv(
  seed: IngredientCleanupSeed,
  path: string,
  execute: boolean,
): number {
  assertUniqueIngredientNames(seed.ingredient);
  const rows: string[][] = seed.ingredient
    .map((ingredient: IngredientRow): string[] => [ingredient.canonical_name, '', '', ''])
    .sort((left: string[], right: string[]): number => left[0].localeCompare(right[0], 'de'));
  const content: string = [cleanupHeaders, ...rows].map(csvLine).join('\n') + '\n';
  if (execute) writeFileSync(path, content, 'utf8');
  return rows.length;
}

export function readCleanupCsv(path: string): CleanupRow[] {
  if (!existsSync(path)) throw new Error(`Ingredient cleanup CSV '${path}' does not exist.`);
  const records: string[][] = parseCsv(readFileSync(path, 'utf8'));
  if (records.length === 0) throw new Error('Ingredient cleanup CSV is empty.');
  const header: string[] = records[0];
  if (
    header.length !== cleanupHeaders.length ||
    !header.every((value: string, index: number): boolean => value === cleanupHeaders[index])
  ) {
    throw new Error(
      `Ingredient cleanup CSV must use these four columns: ${cleanupHeaders.join(', ')}.`,
    );
  }
  const seenIngredientNames: Set<string> = new Set<string>();
  return records.slice(1).map((record: string[], index: number): CleanupRow => {
    const rowNumber: number = index + 2;
    if (record.length !== cleanupHeaders.length)
      throw new Error(`Ingredient cleanup CSV row ${rowNumber} must contain four columns.`);
    const ingredientName: string = record[0];
    if (ingredientName.length === 0)
      throw new Error(`Ingredient cleanup CSV row ${rowNumber} has no ingredient name.`);
    if (seenIngredientNames.has(ingredientName))
      throw new Error(`Ingredient cleanup CSV contains '${ingredientName}' more than once.`);
    seenIngredientNames.add(ingredientName);
    return {
      ingredientName,
      newIngredientName: record[1].trim(),
      modifier: record[2],
      aliasTargetName: record[3].trim(),
    };
  });
}

export function applyIngredientCleanup(
  seed: IngredientCleanupSeed,
  cleanupRows: CleanupRow[],
): IngredientCleanupSeed {
  assertUniqueIngredientNames(seed.ingredient);
  const ingredientByName: Map<string, IngredientRow> = new Map<string, IngredientRow>();
  for (const ingredient of seed.ingredient)
    ingredientByName.set(normalizeName(ingredient.canonical_name), ingredient);
  if (cleanupRows.length !== seed.ingredient.length)
    throw new Error(
      'Ingredient cleanup CSV must contain every ingredient exactly once. Export a new CSV and apply the changes there.',
    );

  const cleanupByIngredientId: Map<string, CleanupRow> = new Map<string, CleanupRow>();
  for (const cleanupRow of cleanupRows) {
    const ingredient: IngredientRow | undefined = ingredientByName.get(
      normalizeName(cleanupRow.ingredientName),
    );
    if (ingredient === undefined)
      throw new Error(
        `Ingredient cleanup CSV references unknown ingredient '${cleanupRow.ingredientName}'.`,
      );
    cleanupByIngredientId.set(ingredient.id, cleanupRow);
  }

  const renameTargetIdBySourceId: Map<string, string> = new Map<string, string>();
  for (const ingredient of seed.ingredient) {
    const cleanupRow: CleanupRow = requiredCleanupRow(cleanupByIngredientId, ingredient.id);
    if (cleanupRow.newIngredientName.length === 0) continue;
    const matchingIngredient: IngredientRow | undefined = ingredientByName.get(
      normalizeName(cleanupRow.newIngredientName),
    );
    if (matchingIngredient !== undefined && matchingIngredient.id !== ingredient.id)
      renameTargetIdBySourceId.set(ingredient.id, matchingIngredient.id);
  }
  for (const sourceId of renameTargetIdBySourceId.keys())
    resolveAliasTarget(sourceId, renameTargetIdBySourceId);

  const targetIdBySourceId: Map<string, string> = new Map<string, string>(renameTargetIdBySourceId);
  for (const ingredient of seed.ingredient) {
    const cleanupRow: CleanupRow = requiredCleanupRow(cleanupByIngredientId, ingredient.id);
    if (cleanupRow.aliasTargetName.length === 0) continue;
    const target: IngredientRow | undefined = ingredientByName.get(
      normalizeName(cleanupRow.aliasTargetName),
    );
    if (target === undefined)
      throw new Error(
        `Alias target '${cleanupRow.aliasTargetName}' for '${ingredient.canonical_name}' does not exist.`,
      );
    const sourceId: string = resolveAliasTarget(ingredient.id, renameTargetIdBySourceId);
    const targetId: string = resolveAliasTarget(target.id, renameTargetIdBySourceId);
    if (sourceId === targetId) continue;
    const existingTargetId: string | undefined = targetIdBySourceId.get(sourceId);
    if (existingTargetId !== undefined && existingTargetId !== targetId)
      throw new Error(
        `Ingredient '${ingredient.canonical_name}' belongs to a merge with conflicting alias targets.`,
      );
    targetIdBySourceId.set(sourceId, targetId);
  }
  for (const sourceId of targetIdBySourceId.keys())
    resolveAliasTarget(sourceId, targetIdBySourceId);

  const finalIngredientId = (ingredientId: string): string =>
    resolveAliasTarget(ingredientId, targetIdBySourceId);
  const survivingIngredients: IngredientRow[] = seed.ingredient.filter(
    (ingredient: IngredientRow): boolean => !targetIdBySourceId.has(ingredient.id),
  );
  const renamedIngredients: IngredientRow[] = survivingIngredients.map(
    (ingredient: IngredientRow): IngredientRow => {
      const cleanupRow: CleanupRow = requiredCleanupRow(cleanupByIngredientId, ingredient.id);
      return {
        ...ingredient,
        canonical_name:
          cleanupRow.newIngredientName.length > 0
            ? cleanupRow.newIngredientName
            : ingredient.canonical_name,
      };
    },
  );
  assertUniqueIngredientNames(renamedIngredients);

  const aliases: IngredientAliasRow[] = seed.ingredient_alias.map(
    (alias: IngredientAliasRow): IngredientAliasRow => ({
      ...alias,
      ingredient_id: finalIngredientId(alias.ingredient_id),
    }),
  );
  const aliasKeys: Set<string> = new Set<string>();
  for (const alias of aliases)
    aliasKeys.add(`${alias.ingredient_id}\u0000${normalizeName(alias.alias)}`);
  const ingredientById: Map<string, IngredientRow> = new Map<string, IngredientRow>();
  for (const ingredient of renamedIngredients) ingredientById.set(ingredient.id, ingredient);
  for (const sourceIngredientId of targetIdBySourceId.keys()) {
    const sourceIngredient: IngredientRow | undefined = seed.ingredient.find(
      (ingredient: IngredientRow): boolean => ingredient.id === sourceIngredientId,
    );
    if (sourceIngredient === undefined)
      throw new Error('Ingredient cleanup source is missing from the seed.');
    const cleanupRow: CleanupRow = requiredCleanupRow(cleanupByIngredientId, sourceIngredientId);
    const aliasName: string =
      cleanupRow.newIngredientName.length > 0
        ? cleanupRow.newIngredientName
        : sourceIngredient.canonical_name;
    const targetIngredientId: string = finalIngredientId(sourceIngredientId);
    const targetIngredient: IngredientRow | undefined = ingredientById.get(targetIngredientId);
    if (targetIngredient === undefined)
      throw new Error('Ingredient cleanup target is missing from the seed.');
    if (normalizeName(aliasName) === normalizeName(targetIngredient.canonical_name)) continue;
    const aliasKey: string = `${targetIngredientId}\u0000${normalizeName(aliasName)}`;
    if (aliasKeys.has(aliasKey)) continue;
    aliases.push({
      id: sourceIngredient.id,
      ingredient_id: targetIngredientId,
      public_id: sourceIngredient.public_id,
      alias: aliasName,
      localization_key: sourceIngredient.localization_key ?? null,
    });
    aliasKeys.add(aliasKey);
  }
  assertNoDuplicateAliases(aliases);
  assertAliasesDoNotMatchCanonicalNames(renamedIngredients, aliases);

  const usages: IngredientUsageRow[] = seed.ingredient_usage.map(
    (usage: IngredientUsageRow): IngredientUsageRow => {
      if (usage.ingredient_id === null) return { ...usage };
      const cleanupRow: CleanupRow | undefined = cleanupByIngredientId.get(usage.ingredient_id);
      if (cleanupRow === undefined)
        return { ...usage, ingredient_id: finalIngredientId(usage.ingredient_id) };
      return {
        ...usage,
        ingredient_id: finalIngredientId(usage.ingredient_id),
        note:
          cleanupRow.modifier.length === 0
            ? usage.note
            : `${usage.note ?? ''} ${cleanupRow.modifier}`,
      };
    },
  );
  return {
    ...seed,
    ingredient: renamedIngredients,
    ingredient_alias: aliases,
    ingredient_usage: usages,
  };
}

export function writeSeedAtomically(seed: IngredientCleanupSeed, path: string): void {
  const temporaryPath: string = resolve(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

function requiredRows<Row extends JsonObject>(
  seed: JsonObject,
  fieldName: string,
  isRow: (value: JsonValue) => value is Row,
): Row[] {
  const value: JsonValue | undefined = seed[fieldName];
  if (!Array.isArray(value) || !value.every(isRow))
    throw new Error(
      `Development content seed field '${fieldName}' must be an array with valid rows.`,
    );
  return value;
}

function requiredCleanupRow(
  cleanupRows: Map<string, CleanupRow>,
  ingredientId: string,
): CleanupRow {
  const row: CleanupRow | undefined = cleanupRows.get(ingredientId);
  if (row === undefined)
    throw new Error('Ingredient cleanup CSV does not contain every ingredient.');
  return row;
}

function resolveAliasTarget(sourceId: string, targetIdBySourceId: Map<string, string>): string {
  const visited: Set<string> = new Set<string>();
  let currentId: string = sourceId;
  while (targetIdBySourceId.has(currentId)) {
    if (visited.has(currentId)) throw new Error('Ingredient cleanup CSV contains an alias cycle.');
    visited.add(currentId);
    const targetId: string | undefined = targetIdBySourceId.get(currentId);
    if (targetId === undefined) break;
    currentId = targetId;
  }
  return currentId;
}

function assertUniqueIngredientNames(ingredients: IngredientRow[]): void {
  const names: Set<string> = new Set<string>();
  for (const ingredient of ingredients) {
    const normalizedName: string = normalizeName(ingredient.canonical_name);
    if (normalizedName.length === 0) throw new Error('Ingredient names must not be empty.');
    if (names.has(normalizedName))
      throw new Error(
        `Ingredient name '${ingredient.canonical_name}' is duplicated after cleanup.`,
      );
    names.add(normalizedName);
  }
}

function assertNoDuplicateAliases(aliases: IngredientAliasRow[]): void {
  const aliasesByIngredientId: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const names: Set<string> = aliasesByIngredientId.get(alias.ingredient_id) ?? new Set<string>();
    const normalizedAlias: string = normalizeName(alias.alias);
    if (normalizedAlias.length === 0) throw new Error('Ingredient aliases must not be empty.');
    if (names.has(normalizedAlias))
      throw new Error(`Ingredient alias '${alias.alias}' would be duplicated after cleanup.`);
    names.add(normalizedAlias);
    aliasesByIngredientId.set(alias.ingredient_id, names);
  }
}

function assertAliasesDoNotMatchCanonicalNames(
  ingredients: IngredientRow[],
  aliases: IngredientAliasRow[],
): void {
  const ingredientIdByName: Map<string, string> = new Map<string, string>();
  for (const ingredient of ingredients)
    ingredientIdByName.set(normalizeName(ingredient.canonical_name), ingredient.id);
  for (const alias of aliases) {
    const matchingIngredientId: string | undefined = ingredientIdByName.get(
      normalizeName(alias.alias),
    );
    if (matchingIngredientId !== undefined && matchingIngredientId !== alias.ingredient_id)
      throw new Error(
        `Ingredient alias '${alias.alias}' conflicts with a canonical ingredient name.`,
      );
  }
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('de');
}

function csvLine(values: readonly string[]): string {
  return values.map(csvValue).join(',');
}

function csvValue(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsv(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value: string = '';
  let isQuoted: boolean = false;
  for (let index: number = 0; index < content.length; index += 1) {
    const character: string = content[index];
    if (isQuoted) {
      if (character === '"' && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') isQuoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      if (value.length > 0) throw new Error('Ingredient cleanup CSV has an invalid quoted value.');
      isQuoted = true;
    } else if (character === ',') {
      record.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = '';
    } else value += character;
  }
  if (isQuoted) throw new Error('Ingredient cleanup CSV has an unterminated quoted value.');
  if (value.length > 0 || record.length > 0) {
    record.push(value);
    records.push(record);
  }
  if (records.length > 0 && records[0][0].charCodeAt(0) === 0xfeff)
    records[0][0] = records[0][0].slice(1);
  return records;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIngredientRow(value: JsonValue): value is IngredientRow {
  return (
    isJsonObject(value) &&
    typeof value.id === 'string' &&
    typeof value.public_id === 'string' &&
    typeof value.canonical_name === 'string'
  );
}

function isIngredientAliasRow(value: JsonValue): value is IngredientAliasRow {
  return (
    isJsonObject(value) &&
    typeof value.ingredient_id === 'string' &&
    typeof value.alias === 'string'
  );
}

function isIngredientUsageRow(value: JsonValue): value is IngredientUsageRow {
  return (
    isJsonObject(value) &&
    (typeof value.ingredient_id === 'string' || value.ingredient_id === null) &&
    (typeof value.note === 'string' || value.note === null)
  );
}
