import type { Category } from './types';

export function recipeCreationCategoryId(
  categories: readonly Category[],
  categoryId: string | null,
): string | null {
  return categories.some((category: Category): boolean => category.public_id === categoryId)
    ? categoryId
    : null;
}

export function recipeCreationPath(
  tenantSlug: string,
  categories: readonly Category[],
  categoryId: string | null,
): string {
  const path: string = `/${encodeURIComponent(tenantSlug)}/recipes/new`;
  const validCategoryId: string | null = recipeCreationCategoryId(categories, categoryId);
  return validCategoryId === null
    ? path
    : `${path}?categoryPublicId=${encodeURIComponent(validCategoryId)}`;
}
