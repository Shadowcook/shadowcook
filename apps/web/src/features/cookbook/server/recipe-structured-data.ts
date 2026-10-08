import type { Translation } from '../../../i18n';
import { localizedUnitSymbol } from '../../../i18n/unit-localization';
import type { Category, IngredientUsage, RecipeDetail } from '../model/types';

interface JsonLdPersonOrOrganization {
  '@type': 'Organization';
  name: string;
}

interface JsonLdHowToStep {
  '@type': 'HowToStep';
  position: number;
  text: string;
}

export interface RecipeJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Recipe';
  '@id': string;
  name: string;
  url: string;
  author: JsonLdPersonOrOrganization;
  description?: string;
  recipeCategory?: string[];
  recipeIngredient: string[];
  recipeInstructions: JsonLdHowToStep[];
}

export function recipeJsonLd(
  recipe: RecipeDetail,
  categories: readonly Category[],
  categoryIds: readonly string[],
  cookbookName: string,
  url: string,
  text: Translation,
): RecipeJsonLd {
  const categoryNames: string[] = categoryIds
    .map(
      (categoryId: string): string | undefined =>
        categories.find((category: Category): boolean => category.public_id === categoryId)?.name,
    )
    .filter((name: string | undefined): name is string => name !== undefined);
  const result: RecipeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    '@id': url,
    name: recipe.title,
    url,
    author: { '@type': 'Organization', name: cookbookName },
    recipeIngredient: recipe.steps.flatMap((step: { ingredients: IngredientUsage[] }) =>
      step.ingredients
        .filter((ingredient: IngredientUsage): boolean => ingredient.special_kind === null)
        .map((ingredient: IngredientUsage): string => recipeIngredientText(ingredient, text)),
    ),
    recipeInstructions: recipe.steps.map(
      (step: { instruction: string }, index: number): JsonLdHowToStep => ({
        '@type': 'HowToStep',
        position: index + 1,
        text: step.instruction,
      }),
    ),
  };
  if (recipe.summary !== null && recipe.summary.length > 0) result.description = recipe.summary;
  if (categoryNames.length > 0) result.recipeCategory = categoryNames;
  return result;
}

export function recipeIngredientText(ingredient: IngredientUsage, text: Translation): string {
  const amount: string | null = formatAmount(ingredient.amount);
  const unit: string | null =
    ingredient.unit_symbol === null
      ? null
      : localizedUnitSymbol(text, ingredient.unit_localization_key, ingredient.unit_symbol);
  const name: string = ingredient.ingredient_name;
  const parts: string[] = [amount, unit, name].filter(
    (value: string | null): value is string => value !== null && value.length > 0,
  );
  if (ingredient.note !== null && ingredient.note.length > 0) parts.push(ingredient.note);
  return parts.join(' ');
}

function formatAmount(amount: string | null): string | null {
  if (amount === null || !amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
