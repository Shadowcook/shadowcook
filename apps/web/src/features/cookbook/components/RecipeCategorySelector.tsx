import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import type { Category } from '../model/types';

interface RecipeCategorySelectorProperties {
  categories: readonly Category[];
  selectedCategoryIds: readonly string[];
  text: Translation;
  onToggleCategory: (categoryId: string) => void;
}

export default function RecipeCategorySelector(
  properties: RecipeCategorySelectorProperties,
): JSX.Element {
  const byParentId: Map<string | null, Category[]> = categoryChildren(properties.categories);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<ReadonlySet<string>>(
    (): ReadonlySet<string> =>
      new Set<string>(ancestorCategoryIds(properties.categories, properties.selectedCategoryIds)),
  );
  useEffect((): void => {
    setExpandedCategoryIds(
      (current: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([
          ...current,
          ...ancestorCategoryIds(properties.categories, properties.selectedCategoryIds),
        ]),
    );
  }, [properties.categories, properties.selectedCategoryIds]);

  function toggleDisclosure(categoryId: string): void {
    setExpandedCategoryIds((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  return (
    <div className="recipe-category-selector">
      {categoryItems(
        null,
        byParentId,
        expandedCategoryIds,
        properties.selectedCategoryIds,
        properties.text,
        properties.onToggleCategory,
        toggleDisclosure,
      )}
    </div>
  );
}

function categoryItems(
  parentId: string | null,
  byParentId: Map<string | null, Category[]>,
  expandedCategoryIds: ReadonlySet<string>,
  selectedCategoryIds: readonly string[],
  text: Translation,
  onToggleCategory: (categoryId: string) => void,
  onToggleDisclosure: (categoryId: string) => void,
): JSX.Element[] {
  const children: Category[] = [...(byParentId.get(parentId) ?? [])].sort(
    (left: Category, right: Category): number =>
      left.sort_order - right.sort_order || left.name.localeCompare(right.name),
  );
  return children.map((category: Category): JSX.Element => {
    const descendants: Category[] = byParentId.get(category.public_id) ?? [];
    const hasDescendants: boolean = descendants.length > 0;
    const isExpanded: boolean = expandedCategoryIds.has(category.public_id);
    const disclosureLabel: string = `${isExpanded ? text.dashboard.collapseCategory : text.dashboard.expandCategory}: ${category.name}`;
    return (
      <div className="recipe-category-selector__item" key={category.public_id}>
        <div className="recipe-category-selector__row">
          {hasDescendants ? (
            <button
              type="button"
              className={
                isExpanded
                  ? 'category-disclosure category-disclosure--expanded'
                  : 'category-disclosure'
              }
              aria-expanded={isExpanded}
              aria-label={disclosureLabel}
              onClick={(): void => onToggleDisclosure(category.public_id)}
            >
              <AdminIcon name={isExpanded ? 'categoryExpanded' : 'categoryCollapsed'} />
            </button>
          ) : (
            <span
              className="category-disclosure category-disclosure--placeholder"
              aria-hidden="true"
            />
          )}
          <label className="recipe-editor__check">
            <input
              type="checkbox"
              checked={selectedCategoryIds.includes(category.public_id)}
              onChange={(): void => onToggleCategory(category.public_id)}
            />
            {category.name}
          </label>
        </div>
        {hasDescendants && isExpanded ? (
          <div className="recipe-category-selector__children">
            {categoryItems(
              category.public_id,
              byParentId,
              expandedCategoryIds,
              selectedCategoryIds,
              text,
              onToggleCategory,
              onToggleDisclosure,
            )}
          </div>
        ) : null}
      </div>
    );
  });
}

function categoryChildren(categories: readonly Category[]): Map<string | null, Category[]> {
  const byParentId: Map<string | null, Category[]> = new Map();
  for (const category of categories) {
    const siblings: Category[] = byParentId.get(category.parent_public_id) ?? [];
    siblings.push(category);
    byParentId.set(category.parent_public_id, siblings);
  }
  return byParentId;
}

function ancestorCategoryIds(
  categories: readonly Category[],
  categoryIds: readonly string[],
): string[] {
  const categoryById: Map<string, Category> = new Map(
    categories.map((category: Category): [string, Category] => [category.public_id, category]),
  );
  const ancestors: Set<string> = new Set();
  for (const categoryId of categoryIds) {
    let current: Category | undefined = categoryById.get(categoryId);
    while (current?.parent_public_id !== null && current?.parent_public_id !== undefined) {
      ancestors.add(current.parent_public_id);
      current = categoryById.get(current.parent_public_id);
    }
  }
  return [...ancestors];
}
