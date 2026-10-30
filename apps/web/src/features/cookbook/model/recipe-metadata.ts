import type { Translation } from '../../../i18n/types.ts';

export type RecipeDiet = 'VEGAN' | 'VEGETARIAN' | 'OMNI';
export type RecipeDifficulty = 'EASY' | 'MEDIUM' | 'DEMANDING';

export function recipeDietFilter(value: string | null): RecipeDiet | '' {
  return value === 'VEGAN' || value === 'VEGETARIAN' || value === 'OMNI' ? value : '';
}

export interface RecipeContentMetadata {
  difficulty: RecipeDifficulty | null;
  totalMinutes: number | null;
  activeMinutes: number | null;
  kcal: number | null;
  servings: number | null;
  utensils: string | null;
}

export interface RecipeFacts {
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface RecipeMetadataRow {
  label: string;
  value: string;
}

export function emptyRecipeMetadata(): RecipeContentMetadata {
  return {
    difficulty: null,
    totalMinutes: null,
    activeMinutes: null,
    kcal: null,
    servings: null,
    utensils: null,
  };
}

export function recipeKcalPerServing(metadata: RecipeContentMetadata): number | null {
  return metadata.kcal === null || metadata.servings === null || metadata.servings <= 0
    ? null
    : metadata.kcal / metadata.servings;
}

export function recipeMetadataRows(
  recipe: Partial<RecipeFacts>,
  text: Translation,
): RecipeMetadataRow[] {
  const rows: RecipeMetadataRow[] = [];
  const metadata: RecipeContentMetadata = recipe.metadata ?? emptyRecipeMetadata();
  const labels: Translation['recipeMetadata'] = text.recipeMetadata;
  const numberFormat: Intl.NumberFormat = new Intl.NumberFormat(text.locale, {
    maximumFractionDigits: 2,
  });
  if (metadata.difficulty !== null)
    rows.push({ label: labels.difficulty, value: labels.difficulties[metadata.difficulty] });
  if (metadata.totalMinutes !== null)
    rows.push({ label: labels.totalDuration, value: recipeDuration(metadata.totalMinutes, text) });
  if (metadata.activeMinutes !== null)
    rows.push({
      label: labels.activeDuration,
      value: recipeDuration(metadata.activeMinutes, text),
    });
  if (metadata.kcal !== null)
    rows.push({ label: labels.kcal, value: numberFormat.format(metadata.kcal) });
  if (metadata.servings !== null)
    rows.push({ label: labels.servings, value: numberFormat.format(metadata.servings) });
  const perServing: number | null = recipeKcalPerServing(metadata);
  if (perServing !== null)
    rows.push({ label: labels.kcalPerServing, value: numberFormat.format(perServing) });
  if (metadata.utensils !== null && metadata.utensils.trim().length > 0)
    rows.push({ label: labels.utensils, value: metadata.utensils });
  if (recipe.diet != null) rows.push({ label: labels.diet, value: labels.diets[recipe.diet] });
  const dateFormat: Intl.DateTimeFormat = new Intl.DateTimeFormat(text.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  if (recipe.createdAt != null)
    rows.push({ label: labels.createdAt, value: dateFormat.format(new Date(recipe.createdAt)) });
  if (recipe.updatedAt != null)
    rows.push({ label: labels.updatedAt, value: dateFormat.format(new Date(recipe.updatedAt)) });
  return rows;
}

function recipeDuration(minutes: number, text: Translation): string {
  const hours: number = Math.floor(minutes / 60);
  const remainder: number = minutes % 60;
  const numberFormat: Intl.NumberFormat = new Intl.NumberFormat(text.locale);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${numberFormat.format(hours)} ${text.recipeMetadata.hours}`);
  if (remainder > 0 || hours === 0)
    parts.push(`${numberFormat.format(remainder)} ${text.recipeMetadata.minutes}`);
  return parts.join(' ');
}
