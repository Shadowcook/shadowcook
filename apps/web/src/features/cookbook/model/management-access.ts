import type { ManagementRoute } from './management-routing';
import type { CookbookResponse } from './types';

export function cookbookManagementPath(
  cookbook: CookbookResponse,
  tenantSlug: string,
): string | null {
  const tenantPath: string = `/${encodeURIComponent(tenantSlug)}`;
  if (cookbook.canManageRecipes) return `${tenantPath}/manage/recipes`;
  if (cookbook.canManageCategories) return `${tenantPath}/categories`;
  if (cookbook.canManageUsers) return `${tenantPath}/manage/settings`;
  if (cookbook.canManageServiceAccounts) return `${tenantPath}/manage/service-accounts`;
  if (cookbook.canManageIngredients) return `${tenantPath}/manage/ingredients`;
  if (cookbook.canManageUnits) return `${tenantPath}/manage/units`;
  return null;
}

export function isCookbookManagementAccessDenied(
  cookbook: CookbookResponse,
  route: ManagementRoute,
): boolean {
  if (route.isCategoryEditor) return !cookbook.canManageCategories;
  switch (route.editorPath) {
    case null:
      return false;
    case 'new':
    case 'import':
      return !cookbook.canCreateRecipes;
    case 'manage':
      return cookbookManagementPath(cookbook, '') === null;
    case 'manage-users':
    case 'manage-recipe-policy':
      return !cookbook.canManageUsers;
    case 'manage-ingredients':
      return !cookbook.canManageIngredients;
    case 'manage-units':
      return !cookbook.canManageUnits;
    case 'manage-service-accounts':
      return !cookbook.canManageServiceAccounts;
    default:
      return !cookbook.canManageRecipes;
  }
}
