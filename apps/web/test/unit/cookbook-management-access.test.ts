import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cookbookManagementPath,
  isCookbookManagementAccessDenied,
} from '../../src/features/cookbook/model/management-access.ts';
import { managementRoute } from '../../src/features/cookbook/model/management-routing.ts';
import type { CookbookResponse } from '../../src/features/cookbook/model/types.ts';

const viewer: CookbookResponse = {
  tenant: {
    public_id: '00000000-0000-4000-8000-000000000001',
    display_name: 'Viewer cookbook',
    frontpage_heading: null,
  },
  categories: [],
  recipes: [],
  frontpage: { recipes: [], page: 1, pageSize: 4, totalPages: 0, totalRecipes: 0 },
  canManageCategories: false,
  canManageRecipes: false,
  canDeleteRecipes: false,
  canCreateRecipes: false,
  canManageUsers: false,
  canManageIngredients: false,
  canManageUnits: false,
  canManageServiceAccounts: false,
  canCreateAiContexts: false,
};

test('Viewer has no Manage Cookbook button destination and every management deep link is denied', (): void => {
  assert.equal(cookbookManagementPath(viewer, 'viewer-cookbook'), null);
  const paths: string[] = [
    'manage',
    'manage/recipes',
    'manage/trash',
    'manage/users',
    'manage/ingredients',
    'manage/units',
    'manage/settings',
    'manage/service-accounts',
    'categories',
    'drafts',
    'recipes/new',
    'manage/recipes/import',
    'recipes/private-recipe/edit',
  ];
  for (const path of paths) {
    assert.equal(
      isCookbookManagementAccessDenied(viewer, managementRoute(`/viewer-cookbook/${path}`)),
      true,
      path,
    );
  }
  assert.equal(
    isCookbookManagementAccessDenied(viewer, managementRoute('/viewer-cookbook')),
    false,
  );
});

test('ingredient managers can enter their section while unrelated sections remain denied', (): void => {
  const manager: CookbookResponse = { ...viewer, canManageIngredients: true };
  assert.equal(cookbookManagementPath(manager, 'my cookbook'), '/my%20cookbook/manage/ingredients');
  assert.equal(
    isCookbookManagementAccessDenied(manager, managementRoute('/my-cookbook/manage')),
    false,
  );
  assert.equal(
    isCookbookManagementAccessDenied(manager, managementRoute('/my-cookbook/manage/ingredients')),
    false,
  );
  assert.equal(
    isCookbookManagementAccessDenied(manager, managementRoute('/my-cookbook/manage/units')),
    true,
  );
});

test('recipe update permission alone cannot open the creation editor', (): void => {
  const editor: CookbookResponse = { ...viewer, canManageRecipes: true };
  assert.equal(
    isCookbookManagementAccessDenied(editor, managementRoute('/cookbook/recipes/new')),
    true,
  );
  assert.equal(
    isCookbookManagementAccessDenied(editor, managementRoute('/cookbook/recipes/recipe-id/edit')),
    false,
  );
  assert.equal(
    isCookbookManagementAccessDenied(
      { ...editor, canCreateRecipes: true },
      managementRoute('/cookbook/recipes/new'),
    ),
    false,
  );
});

test('trash deep links require delete permission and support delete-only managers', (): void => {
  const route: ReturnType<typeof managementRoute> = managementRoute('/cookbook/manage/trash');
  assert.equal(route.editorPath, 'trash');
  assert.equal(
    isCookbookManagementAccessDenied({ ...viewer, canManageRecipes: true }, route),
    true,
  );
  const manager: CookbookResponse = { ...viewer, canDeleteRecipes: true };
  assert.equal(cookbookManagementPath(manager, 'cookbook'), '/cookbook/manage/trash');
  assert.equal(isCookbookManagementAccessDenied(manager, route), false);
});
