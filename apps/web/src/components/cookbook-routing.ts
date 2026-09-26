import type { Category, CookbookResponse, Recipe } from './cookbook-types';

const recipePathSegment: string = 'recipes';

export interface CookbookLocation {
  categoryId: string | null;
  recipe: Recipe | null;
}

export function categoryPath(categories: readonly Category[], categoryId: string): string[] | null {
  const categoriesById: Map<string, Category> = new Map(
    categories.map((category: Category): [string, Category] => [category.public_id, category]),
  );
  const segments: string[] = [];
  let current: Category | undefined = categoriesById.get(categoryId);
  while (current !== undefined) {
    segments.unshift(current.slug);
    current =
      current.parent_public_id === null ? undefined : categoriesById.get(current.parent_public_id);
  }
  return segments.length === 0 ? null : segments;
}

export function cookbookPath(
  tenantSlug: string,
  categories: readonly Category[],
  categoryId: string | null,
  recipe: Recipe | null,
): string {
  const segments: string[] | null =
    categoryId === null ? null : categoryPath(categories, categoryId);
  if (recipe === null)
    return segments === null ? `/${tenantSlug}` : `/${tenantSlug}/${segments.join('/')}`;
  if (segments === null) return `/${tenantSlug}/${recipePathSegment}/${recipe.slug}`;
  return `/${tenantSlug}/${segments.join('/')}/${recipePathSegment}/${recipe.slug}`;
}

export function resolveCookbookLocation(
  cookbook: CookbookResponse,
  pathname: string,
): CookbookLocation {
  const segments: string[] = pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0)
    .map((segment: string): string => decodeURIComponent(segment));
  if (segments.length <= 1) return { categoryId: null, recipe: null };
  segments.shift();
  const recipeIndex: number = segments.indexOf(recipePathSegment);
  const categorySegments: string[] = recipeIndex === -1 ? segments : segments.slice(0, recipeIndex);
  if (recipeIndex !== -1 && recipeIndex !== segments.length - 2)
    return { categoryId: null, recipe: null };
  const categoryId: string | null = categoryIdForSegments(cookbook.categories, categorySegments);
  if (categorySegments.length > 0 && categoryId === null) return { categoryId: null, recipe: null };
  if (recipeIndex === -1) return { categoryId, recipe: null };
  const recipe: Recipe | undefined = cookbook.recipes.find(
    (candidate: Recipe): boolean =>
      candidate.slug === segments[recipeIndex + 1] &&
      (categoryId === null || candidate.category_public_ids.includes(categoryId)),
  );
  return { categoryId, recipe: recipe ?? null };
}

function categoryIdForSegments(
  categories: readonly Category[],
  segments: readonly string[],
): string | null {
  let parentId: string | null = null;
  for (const segment of segments) {
    const category: Category | undefined = categories.find(
      (candidate: Category): boolean =>
        candidate.parent_public_id === parentId && candidate.slug === segment,
    );
    if (category === undefined) return null;
    parentId = category.public_id;
  }
  return parentId;
}
