import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { CookbookResponse } from '../model/types';

interface TenantNavigationProperties {
  text: Translation;
  cookbook: CookbookResponse;
  activeView:
    | 'none'
    | 'recipes'
    | 'drafts'
    | 'categories'
    | 'users'
    | 'ingredients'
    | 'units'
    | 'settings'
    | 'service-accounts'
    | 'editor';
  tenantSlug: string;
}

export default function TenantNavigation(properties: TenantNavigationProperties): JSX.Element {
  const { text, cookbook, activeView, tenantSlug } = properties;
  return (
    <aside className="tenant-navigation">
      <p className="eyebrow">{text.tenantNavigation.title}</p>
      <nav aria-label={text.tenantNavigation.title}>
        <a
          className={
            activeView === 'recipes'
              ? 'tenant-navigation__link tenant-navigation__link--active'
              : 'tenant-navigation__link'
          }
          href={`/${encodeURIComponent(tenantSlug)}/manage/recipes`}
        >
          {text.tenantNavigation.recipes}
        </a>
        {cookbook.canManageRecipes ? (
          <a
            className={
              activeView === 'drafts' || activeView === 'editor'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/drafts`}
          >
            {text.recipeEditor.drafts}
          </a>
        ) : null}
        {cookbook.canManageCategories ? (
          <a
            className={
              activeView === 'categories'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/categories`}
          >
            {text.tenantNavigation.categories}
          </a>
        ) : null}
        {cookbook.canManageUsers ? (
          <a
            className={
              activeView === 'settings'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/manage/settings`}
          >
            {text.tenantNavigation.settings}
          </a>
        ) : null}
        {cookbook.canManageServiceAccounts ? (
          <a
            className={
              activeView === 'service-accounts'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/manage/service-accounts`}
          >
            {text.tenantNavigation.serviceAccounts}
          </a>
        ) : null}
        {cookbook.canManageUsers ? (
          <a
            className={
              activeView === 'users'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/manage/users`}
          >
            {text.tenantNavigation.users}
          </a>
        ) : null}
        {cookbook.canManageIngredients ? (
          <a
            className={
              activeView === 'ingredients'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/manage/ingredients`}
          >
            {text.tenantNavigation.ingredients}
          </a>
        ) : null}
        {cookbook.canManageUnits ? (
          <a
            className={
              activeView === 'units'
                ? 'tenant-navigation__link tenant-navigation__link--active'
                : 'tenant-navigation__link'
            }
            href={`/${encodeURIComponent(tenantSlug)}/manage/units`}
          >
            {text.tenantNavigation.units}
          </a>
        ) : null}
      </nav>
      {cookbook.canManageRecipes ? (
        <a className="button-link" href={`/${encodeURIComponent(tenantSlug)}/recipes/new`}>
          {text.recipeEditor.create}
        </a>
      ) : null}
    </aside>
  );
}
