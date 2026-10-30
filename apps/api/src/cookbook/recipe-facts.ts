import type { PoolClient } from 'pg';

export type RecipeDiet = 'VEGAN' | 'VEGETARIAN' | 'OMNI';

export interface RecipeContentMetadata {
  difficulty: 'EASY' | 'MEDIUM' | 'DEMANDING' | null;
  totalMinutes: number | null;
  activeMinutes: number | null;
  kcal: number | null;
  servings: number | null;
  utensils: string | null;
}

export interface RecipeFactsInput {
  metadata?: RecipeContentMetadata;
  diet?: RecipeDiet | null;
}

export interface RecipeFactsRow {
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export function recipeFactsSql(
  revisionAlias: string,
  publishedAlias: string = revisionAlias,
): string {
  return `${recipeMetadataSql(revisionAlias)},
    recipe.created_at AS "createdAt", ${publishedAlias}.published_at AS "updatedAt"`;
}

export function recipeMetadataSql(revisionAlias: string): string {
  return `(SELECT ${variantMetadataExpression('facts_variant')} FROM recipe_variant AS facts_variant
    WHERE facts_variant.recipe_revision_id = ${revisionAlias}.id AND facts_variant.is_default) AS metadata,
    ${defaultVariantDietSql(revisionAlias)} AS diet`;
}

export function defaultVariantDietSql(revisionAlias: string): string {
  return `(SELECT diet FROM recipe_variant WHERE recipe_revision_id = ${revisionAlias}.id AND is_default)`;
}

export function variantDietFilterSql(revisionAlias: string, parameter: string): string {
  return `EXISTS (
    SELECT 1 FROM recipe_variant AS diet_variant
    WHERE diet_variant.recipe_revision_id = ${revisionAlias}.id
      AND (diet_variant.is_visible OR diet_variant.is_default)
      AND diet_variant.diet = ANY(${parameter})
  )`;
}

export function variantMetadataExpression(alias: string): string {
  return `json_build_object(
    'difficulty', ${alias}.difficulty,
    'totalMinutes', ${alias}.total_minutes,
    'activeMinutes', ${alias}.active_minutes,
    'kcal', ${alias}.kcal,
    'servings', ${alias}.servings,
    'utensils', ${alias}.utensils
  )`;
}

export function variantFactsSql(alias: string): string {
  return `${variantMetadataExpression(alias)} AS metadata, ${alias}.diet`;
}

export function parseRecipeFactsInput(body: Record<string, unknown>): RecipeFactsInput | null {
  if (
    Object.hasOwn(body, 'createdAt') ||
    Object.hasOwn(body, 'updatedAt') ||
    Object.hasOwn(body, 'kcalPerServing')
  )
    return null;
  const result: RecipeFactsInput = {};
  if (body.diet !== undefined) {
    if (
      body.diet !== null &&
      body.diet !== 'VEGAN' &&
      body.diet !== 'VEGETARIAN' &&
      body.diet !== 'OMNI'
    )
      return null;
    result.diet = body.diet;
  }
  if (body.metadata === undefined) return result;
  if (typeof body.metadata !== 'object' || body.metadata === null || Array.isArray(body.metadata))
    return null;
  const metadata: Record<string, unknown> = body.metadata as Record<string, unknown>;
  const allowedFields: string[] = [
    'difficulty',
    'totalMinutes',
    'activeMinutes',
    'kcal',
    'servings',
    'utensils',
  ];
  if (Object.keys(metadata).some((key: string): boolean => !allowedFields.includes(key)))
    return null;
  const difficulty: unknown = metadata.difficulty ?? null;
  if (
    difficulty !== null &&
    difficulty !== 'EASY' &&
    difficulty !== 'MEDIUM' &&
    difficulty !== 'DEMANDING'
  )
    return null;
  if (
    !validNumber(metadata.totalMinutes, 5256000, true) ||
    !validNumber(metadata.activeMinutes, 5256000, true) ||
    !validNumber(metadata.kcal, 1000000000, false) ||
    !validNumber(metadata.servings, 1000000, false, true)
  )
    return null;
  if (
    metadata.utensils != null &&
    (typeof metadata.utensils !== 'string' || metadata.utensils.length > 4000)
  )
    return null;
  const totalMinutes: number | null = (metadata.totalMinutes as number | null | undefined) ?? null;
  const activeMinutes: number | null =
    (metadata.activeMinutes as number | null | undefined) ?? null;
  if (totalMinutes !== null && activeMinutes !== null && activeMinutes > totalMinutes) return null;
  result.metadata = {
    difficulty,
    totalMinutes,
    activeMinutes,
    kcal: (metadata.kcal as number | null | undefined) ?? null,
    servings: (metadata.servings as number | null | undefined) ?? null,
    utensils:
      typeof metadata.utensils === 'string' && metadata.utensils.trim().length > 0
        ? metadata.utensils
        : null,
  };
  return result;
}

function validNumber(
  value: unknown,
  maximum: number,
  integer: boolean,
  positive: boolean = false,
): boolean {
  return (
    value == null ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      (positive ? value > 0 : value >= 0) &&
      value <= maximum &&
      (!integer || Number.isInteger(value)))
  );
}

export async function saveRecipeFacts(
  client: PoolClient,
  revisionId: string,
  input: RecipeFactsInput,
  variantId: string | null = null,
): Promise<void> {
  if (input.metadata !== undefined) {
    const metadata: RecipeContentMetadata = input.metadata;
    await client.query(
      `UPDATE recipe_variant SET difficulty = $2, total_minutes = $3, active_minutes = $4,
        kcal = $5, servings = $6, utensils = $7 WHERE recipe_revision_id = $1 AND (CASE WHEN $8::uuid IS NULL THEN is_default ELSE id = $8 END)`,
      [
        revisionId,
        metadata.difficulty,
        metadata.totalMinutes,
        metadata.activeMinutes,
        metadata.kcal,
        metadata.servings,
        metadata.utensils,
        variantId,
      ],
    );
  }
  if (input.diet !== undefined)
    await client.query(
      'UPDATE recipe_variant SET diet = $2 WHERE recipe_revision_id = $1 AND (CASE WHEN $3::uuid IS NULL THEN is_default ELSE id = $3 END)',
      [revisionId, input.diet, variantId],
    );
}

export function recipeDietFilterValues(value: RecipeDiet): RecipeDiet[] {
  if (value === 'VEGAN') return ['VEGAN'];
  if (value === 'VEGETARIAN') return ['VEGAN', 'VEGETARIAN'];
  return ['VEGAN', 'VEGETARIAN', 'OMNI'];
}

export function isRecipeDiet(value: unknown): value is RecipeDiet {
  return value === 'VEGAN' || value === 'VEGETARIAN' || value === 'OMNI';
}
