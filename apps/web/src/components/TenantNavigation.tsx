import type { JSX } from 'react';
import type { Translation } from '../i18n';
import type { CookbookResponse } from './cookbook-types';

interface TenantNavigationProperties {
  text: Translation;
  cookbook: CookbookResponse;
  activeView: 'none' | 'recipes' | 'drafts' | 'categories' | 'users' | 'ingredients' | 'editor';
  onOpenRecipes: () => void;
  onOpenDrafts: () => void;
  onOpenCategories: () => void;
  onOpenUsers: () => void;
  onOpenIngredients: () => void;
  onCreateRecipe: () => void;
}

export default function TenantNavigation(properties: TenantNavigationProperties): JSX.Element {
  const {
    text,
    cookbook,
    activeView,
    onOpenRecipes,
    onOpenDrafts,
    onOpenCategories,
    onOpenUsers,
    onOpenIngredients,
    onCreateRecipe,
  } = properties;
  return (
    <aside className="tenant-navigation">
      <p className="eyebrow">{text.tenantNavigation.title}</p>
      <nav aria-label={text.tenantNavigation.title}>
        <button
          type="button"
          className={
            activeView === 'recipes'
              ? 'tenant-navigation__link tenant-navigation__link--active'
              : 'tenant-navigation__link'
          }
          onClick={onOpenRecipes}
        >
          {text.tenantNavigation.recipes}
        </button>
        {cookbook.canManageRecipes ? (
          <button
            type="button"
            className={
              activeView === 'drafts' || activeView === 'editor'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            onClick={onOpenDrafts}
          >
            {text.recipeEditor.drafts}
          </button>
        ) : null}
        {cookbook.canManageCategories ? (
          <button
            type="button"
            className={
              activeView === 'categories'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            onClick={onOpenCategories}
          >
            {text.tenantNavigation.categories}
          </button>
        ) : null}
        {cookbook.canManageUsers ? (
          <button
            type="button"
            className={
              activeView === 'users'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            onClick={onOpenUsers}
          >
            {text.tenantNavigation.users}
          </button>
        ) : null}
        {cookbook.canManageIngredients ? (
          <button
            type="button"
            className={
              activeView === 'ingredients'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            onClick={onOpenIngredients}
          >
            {text.tenantNavigation.ingredients}
          </button>
        ) : null}
      </nav>
      {cookbook.canManageRecipes ? (
        <button type="button" onClick={onCreateRecipe}>
          {text.recipeEditor.create}
        </button>
      ) : null}
    </aside>
  );
}
