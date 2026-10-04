import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  LegacyCategory,
  LegacyCookbook,
  LegacyIngredientUsage,
  LegacyRecipe,
  LegacyStep,
  LegacyUnit,
} from './model.js';

interface SourceRecord {
  readonly [key: string]: boolean | number | string | null;
  type: string;
}

const executeFile = promisify(execFile);

export function resolveHsqldbJar(configuredPath: string | undefined): string {
  if (configuredPath !== undefined && configuredPath.trim().length > 0) {
    const path: string = configuredPath.trim();
    accessSync(path, constants.R_OK);
    return path;
  }

  const repositoryPath: string = `${homedir()}/.m2/repository/org/hsqldb/hsqldb`;
  if (!existsSync(repositoryPath)) {
    throw new Error('SOURCE_DB_HSQLDB_JAR must point to a readable HSQLDB JDBC driver JAR.');
  }
  const candidates: string[] = readdirSync(repositoryPath, { withFileTypes: true })
    .filter((entry): boolean => entry.isDirectory())
    .map((entry): string => `${repositoryPath}/${entry.name}/hsqldb-${entry.name}.jar`)
    .filter((path: string): boolean => existsSync(path))
    .sort((left: string, right: string): number =>
      right.localeCompare(left, 'en', { numeric: true }),
    );
  const candidate: string | undefined = candidates[0];
  if (candidate === undefined) {
    throw new Error('SOURCE_DB_HSQLDB_JAR must point to a readable HSQLDB JDBC driver JAR.');
  }
  return candidate;
}

export async function readLegacyCookbook(hsqldbJarPath: string): Promise<LegacyCookbook> {
  const readerPath: string = fileURLToPath(
    new URL('../../java/LegacyCookbookReader.java', import.meta.url),
  );
  const result: { stdout: string; stderr: string } = await executeFile(
    'java',
    ['-cp', hsqldbJarPath, readerPath],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.stderr.trim().length > 0) process.stderr.write(result.stderr);
  return buildCookbook(
    result.stdout
      .split('\n')
      .filter((line: string): boolean => line.trim().length > 0)
      .map((line: string): SourceRecord => parseSourceRecord(line)),
  );
}

function buildCookbook(records: SourceRecord[]): LegacyCookbook {
  const categories: LegacyCategory[] = [];
  const units: LegacyUnit[] = [];
  const recipesById: Map<number, LegacyRecipe> = new Map<number, LegacyRecipe>();
  const stepsById: Map<number, LegacyStep> = new Map<number, LegacyStep>();

  for (const record of records) {
    if (record.type === 'category') {
      categories.push({
        id: requiredNumber(record, 'cat_id'),
        name: requiredString(record, 'cat_name'),
        parentId: requiredNumber(record, 'cat_parent'),
      });
    } else if (record.type === 'unit') {
      units.push({
        id: requiredNumber(record, 'uom_id'),
        name: requiredString(record, 'uom_name'),
        deleted: requiredBoolean(record, 'uom_deleted'),
      });
    } else if (record.type === 'recipe') {
      const recipe: LegacyRecipe = {
        id: requiredNumber(record, 'recipe_id'),
        name: requiredString(record, 'recipe_name'),
        description: optionalString(record, 'recipe_description'),
        thumbnail: optionalString(record, 'recipe_thumbnail'),
        categoryIds: [],
        steps: [],
      };
      recipesById.set(recipe.id, recipe);
    } else if (record.type === 'recipeCategory') {
      const recipe: LegacyRecipe = requiredMapValue(
        recipesById,
        requiredNumber(record, 'rc_recipe'),
        'recipe category',
      );
      recipe.categoryIds.push(requiredNumber(record, 'rc_category'));
    } else if (record.type === 'step') {
      const step: LegacyStep = {
        id: requiredNumber(record, 'step_id'),
        instruction: optionalString(record, 'step_description'),
        sortOrder: requiredNumber(record, 'step_order'),
        ingredientUsages: [],
      };
      const recipe: LegacyRecipe = requiredMapValue(
        recipesById,
        requiredNumber(record, 'step_recipe'),
        'step recipe',
      );
      recipe.steps.push(step);
      stepsById.set(step.id, step);
    } else if (record.type === 'ingredientUsage') {
      const step: LegacyStep = requiredMapValue(
        stepsById,
        requiredNumber(record, 'si_step'),
        'ingredient step',
      );
      const usage: LegacyIngredientUsage = {
        id: requiredNumber(record, 'si_id'),
        name: optionalString(record, 'si_name'),
        unitId: requiredNumber(record, 'si_uom'),
        amount: optionalNumericString(record, 'si_value'),
        sortOrder: requiredNumber(record, 'si_order'),
      };
      step.ingredientUsages.push(usage);
    } else {
      throw new Error(`Unsupported legacy source record '${record.type}'.`);
    }
  }

  const cookbook: LegacyCookbook = {
    categories,
    units,
    recipes: [...recipesById.values()],
  };
  validateCookbook(cookbook);
  return cookbook;
}

function validateCookbook(cookbook: LegacyCookbook): void {
  const categoryIds: Set<number> = new Set<number>(
    cookbook.categories.map((category: LegacyCategory): number => category.id),
  );
  const unitIds: Set<number> = new Set<number>(
    cookbook.units.map((unit: LegacyUnit): number => unit.id),
  );
  const rootCategories: LegacyCategory[] = cookbook.categories.filter(
    (category: LegacyCategory): boolean => category.parentId < 0,
  );
  if (rootCategories.length !== 1)
    throw new Error('The legacy cookbook must have exactly one technical root category.');
  for (const category of cookbook.categories) {
    if (category.parentId >= 0 && !categoryIds.has(category.parentId))
      throw new Error(`Legacy category ${category.id} has an unknown parent.`);
  }
  for (const recipe of cookbook.recipes) {
    if (recipe.categoryIds.length === 0)
      throw new Error(`Legacy recipe ${recipe.id} has no category.`);
    if (recipe.steps.length === 0) throw new Error(`Legacy recipe ${recipe.id} has no steps.`);
    for (const categoryId of recipe.categoryIds)
      if (!categoryIds.has(categoryId))
        throw new Error(`Legacy recipe ${recipe.id} references an unknown category.`);
    for (const step of recipe.steps)
      for (const usage of step.ingredientUsages)
        if (!unitIds.has(usage.unitId))
          throw new Error(`Legacy ingredient usage ${usage.id} references an unknown unit.`);
  }
}

function parseSourceRecord(line: string): SourceRecord {
  const value: unknown = JSON.parse(line);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('The legacy database reader returned an invalid record.');
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record.type !== 'string')
    throw new Error('The legacy database reader returned a record without a type.');
  return value as SourceRecord;
}

function requiredNumber(record: SourceRecord, name: string): number {
  const value: boolean | number | string | null | undefined = record[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`Legacy field '${name}' must be an integer.`);
  return value;
}

function requiredBoolean(record: SourceRecord, name: string): boolean {
  const value: boolean | number | string | null | undefined = record[name];
  if (typeof value !== 'boolean') throw new Error(`Legacy field '${name}' must be a boolean.`);
  return value;
}

function requiredString(record: SourceRecord, name: string): string {
  const value: boolean | number | string | null | undefined = record[name];
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`Legacy field '${name}' must be a non-empty string.`);
  return value;
}

function optionalString(record: SourceRecord, name: string): string | null {
  const value: boolean | number | string | null | undefined = record[name];
  if (value === null) return null;
  if (typeof value !== 'string')
    throw new Error(`Legacy field '${name}' must be a string or null.`);
  return value;
}

function optionalNumericString(record: SourceRecord, name: string): string | null {
  const value: boolean | number | string | null | undefined = record[name];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Legacy field '${name}' must be a finite number or null.`);
  return value.toString();
}

function requiredMapValue<T>(values: Map<number, T>, id: number, context: string): T {
  const value: T | undefined = values.get(id);
  if (value === undefined) throw new Error(`The legacy ${context} reference ${id} is invalid.`);
  return value;
}
