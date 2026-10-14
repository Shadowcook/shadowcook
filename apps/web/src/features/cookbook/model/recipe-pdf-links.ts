import type { RecipeDetail, RecipeVariant } from './types.ts';

export interface RecipePdfLinkContext {
  tenantSlug: string;
  origin: string;
}

export function recipePdfLinkUrl(
  recipeSlug: string,
  context: RecipePdfLinkContext,
  variantSlug?: string,
): string {
  const variantPath: string =
    variantSlug === undefined ? '' : `/${encodeURIComponent(variantSlug)}`;
  return new URL(
    `/${encodeURIComponent(context.tenantSlug)}/recipes/${encodeURIComponent(recipeSlug)}${variantPath}`,
    context.origin,
  ).href;
}

export function recipePdfSourceUrl(recipe: RecipeDetail, context: RecipePdfLinkContext): string {
  const variant: RecipeVariant | undefined = recipe.variants.find(
    (candidate: RecipeVariant): boolean => candidate.slug === recipe.selectedVariant,
  );
  return recipePdfLinkUrl(
    recipe.slug,
    context,
    variant !== undefined && !variant.is_default ? variant.slug : undefined,
  );
}
