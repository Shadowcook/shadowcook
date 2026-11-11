import type { CookbookResponse, Recipe } from '../model/types';

// Detail rendering and variant navigation need only the current summary.
// Keep categories for breadcrumbs; overview routes load their own lists.
export function recipePageCookbook(cookbook: CookbookResponse, recipeId: string): CookbookResponse {
  return {
    ...cookbook,
    recipes: cookbook.recipes.filter((recipe: Recipe): boolean => recipe.public_id === recipeId),
    frontpage: { ...cookbook.frontpage, recipes: [] },
  };
}
