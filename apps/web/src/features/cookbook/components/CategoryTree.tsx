import { useEffect, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import { cookbookPath } from '../model/routing';
import type { Category } from '../model/types';

interface CategoryTreeProperties {
  categories: readonly Category[];
  selectedCategoryId: string | null;
  text: Translation;
  tenantSlug: string;
  onCategoryNavigate?: (event: MouseEvent<HTMLAnchorElement>, targetPath: string) => void;
  onNavigate?: () => void;
}

export default function CategoryTree(properties: CategoryTreeProperties): JSX.Element {
  const { categories, selectedCategoryId, text, tenantSlug, onCategoryNavigate, onNavigate } =
    properties;
  const byParentId: Map<string | null, Category[]> = new Map();
  for (const category of categories) {
    const siblings: Category[] = byParentId.get(category.parent_public_id) ?? [];
    siblings.push(category);
    byParentId.set(category.parent_public_id, siblings);
  }
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  useEffect((): void => {
    if (selectedCategoryId === null) return;
    setExpandedCategoryIds(
      (current: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([...current, ...ancestorCategoryIds(categories, selectedCategoryId)]),
    );
  }, [categories, selectedCategoryId]);

  function toggleCategory(categoryId: string): void {
    setExpandedCategoryIds((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  return (
    <div className="category-tree">
      {categoryTreeItems(
        null,
        categories,
        byParentId,
        expandedCategoryIds,
        selectedCategoryId,
        text,
        tenantSlug,
        onCategoryNavigate,
        toggleCategory,
        onNavigate,
      )}
    </div>
  );
}

function categoryTreeItems(
  parentId: string | null,
  categories: readonly Category[],
  byParentId: Map<string | null, Category[]>,
  expandedCategoryIds: ReadonlySet<string>,
  selectedCategoryId: string | null,
  text: Translation,
  tenantSlug: string,
  onCategoryNavigate:
    ((event: MouseEvent<HTMLAnchorElement>, targetPath: string) => void) | undefined,
  onToggleCategory: (categoryId: string) => void,
  onNavigate: (() => void) | undefined,
): JSX.Element[] {
  const children: Category[] = byParentId.get(parentId) ?? [];
  children.sort(
    (left: Category, right: Category): number =>
      left.sort_order - right.sort_order || left.name.localeCompare(right.name),
  );
  return children.map((category: Category): JSX.Element => {
    const descendants: Category[] = byParentId.get(category.public_id) ?? [];
    const isExpanded: boolean = expandedCategoryIds.has(category.public_id);
    const hasDescendants: boolean = descendants.length > 0;
    const categoryPath: string = cookbookPath(tenantSlug, categories, category.public_id, null);
    const disclosureLabel: string = `${isExpanded ? text.dashboard.collapseCategory : text.dashboard.expandCategory}: ${category.name}`;
    return (
      <div className="category-tree__item" key={category.public_id}>
        <div className="category-tree__row">
          {hasDescendants ? (
            <button
              aria-expanded={isExpanded}
              aria-label={disclosureLabel}
              className={
                isExpanded
                  ? 'category-disclosure category-disclosure--expanded'
                  : 'category-disclosure'
              }
              type="button"
              onClick={(): void => onToggleCategory(category.public_id)}
            >
              <AdminIcon name={isExpanded ? 'categoryExpanded' : 'categoryCollapsed'} />
            </button>
          ) : (
            <span
              className="category-disclosure category-disclosure--placeholder"
              aria-hidden="true"
            />
          )}
          <a
            className={
              selectedCategoryId === category.public_id
                ? 'category-button category-button--active'
                : 'category-button'
            }
            href={categoryPath}
            onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
              onCategoryNavigate?.(event, categoryPath);
              onNavigate?.();
            }}
          >
            {category.name}
          </a>
        </div>
        {hasDescendants && isExpanded ? (
          <div className="category-tree__children">
            {categoryTreeItems(
              category.public_id,
              categories,
              byParentId,
              expandedCategoryIds,
              selectedCategoryId,
              text,
              tenantSlug,
              onCategoryNavigate,
              onToggleCategory,
              onNavigate,
            )}
          </div>
        ) : null}
      </div>
    );
  });
}

function ancestorCategoryIds(categories: readonly Category[], categoryId: string): string[] {
  const ancestors: string[] = [];
  let current: Category | undefined = categories.find(
    (category: Category): boolean => category.public_id === categoryId,
  );
  while (current?.parent_public_id !== null && current?.parent_public_id !== undefined) {
    ancestors.push(current.parent_public_id);
    current = categories.find(
      (category: Category): boolean => category.public_id === current?.parent_public_id,
    );
  }
  return ancestors;
}
