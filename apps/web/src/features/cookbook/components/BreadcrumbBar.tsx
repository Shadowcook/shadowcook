import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { cookbookPath } from '../model/routing';
import type { Category, RecipeDetail } from '../model/types';

interface BreadcrumbBarProperties {
  categories: readonly Category[];
  selectedCategoryId: string | null;
  selectedRecipe: RecipeDetail | null;
  cookbookName: string;
  text: Translation;
  tenantSlug: string;
}

export default function BreadcrumbBar(properties: BreadcrumbBarProperties): JSX.Element {
  const { categories, selectedCategoryId, selectedRecipe, cookbookName, text, tenantSlug } = properties;
  const categoryTrail: Category[] = categoryTrailFor(categories, selectedCategoryId);
  const currentLabel: string | null = selectedRecipe === null ? null : selectedRecipe.title;
  return (
    <nav aria-label={text.dashboard.breadcrumb} className="breadcrumb">
      <ol>
        <li>
          {categoryTrail.length === 0 && currentLabel === null ? (
            <span aria-current="page">{cookbookName}</span>
          ) : (
            <a href={cookbookPath(tenantSlug, categories, null, null)}>
              {cookbookName}
            </a>
          )}
        </li>
        {categoryTrail.map((category: Category, index: number): JSX.Element => {
          const isCurrentCategory: boolean =
            index === categoryTrail.length - 1 && currentLabel === null;
          return (
            <li key={category.public_id}>
              {isCurrentCategory ? (
                <span aria-current="page">{category.name}</span>
              ) : (
                <a href={cookbookPath(tenantSlug, categories, category.public_id, null)}>
                  {category.name}
                </a>
              )}
            </li>
          );
        })}
        {currentLabel === null ? null : (
          <li>
            <span aria-current="page">{currentLabel}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function categoryTrailFor(
  categories: readonly Category[],
  selectedCategoryId: string | null,
): Category[] {
  if (selectedCategoryId === null) return [];
  const categoriesById: Map<string, Category> = new Map(
    categories.map((category: Category): [string, Category] => [category.public_id, category]),
  );
  const trail: Category[] = [];
  let current: Category | undefined = categoriesById.get(selectedCategoryId);
  while (current !== undefined) {
    trail.unshift(current);
    current =
      current.parent_public_id === null ? undefined : categoriesById.get(current.parent_public_id);
  }
  return trail;
}
