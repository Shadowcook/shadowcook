import { useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import { cookbookPath } from '../model/routing';
import type { Category } from '../model/types';
import CategoryTree from './CategoryTree';

interface MobileCategoryDrawerProperties {
  categories: readonly Category[];
  selectedCategoryId: string | null;
  text: Translation;
  tenantSlug: string;
  onCategoryNavigate: (event: MouseEvent<HTMLAnchorElement>, targetPath: string) => void;
}

export default function MobileCategoryDrawer(
  properties: MobileCategoryDrawerProperties,
): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const triggerReference = useRef<HTMLButtonElement>(null);
  const closeReference = useRef<HTMLButtonElement>(null);

  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;
    document.body.classList.add('category-drawer-open');
    closeReference.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return (): void => {
      document.body.classList.remove('category-drawer-open');
      window.removeEventListener('keydown', closeOnEscape);
      triggerReference.current?.focus();
    };
  }, [isOpen]);

  function closeDrawer(): void {
    setIsOpen(false);
  }

  return (
    <div className="mobile-category-menu">
      <button
        ref={triggerReference}
        type="button"
        className="mobile-category-menu__trigger"
        aria-label={properties.text.dashboard.openCategories}
        aria-expanded={isOpen}
        aria-controls="mobile-category-drawer"
        onClick={(): void => setIsOpen(true)}
      >
        <AdminIcon name="menu" />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            className="mobile-category-menu__backdrop"
            aria-label={properties.text.dashboard.closeCategories}
            onClick={closeDrawer}
          />
          <aside
            id="mobile-category-drawer"
            className="mobile-category-menu__drawer"
            aria-label={properties.text.dashboard.categories}
          >
            <header className="mobile-category-menu__drawer-header">
              <p className="eyebrow">{properties.text.dashboard.categories}</p>
              <button
                ref={closeReference}
                type="button"
                className="mobile-category-menu__close"
                aria-label={properties.text.dashboard.closeCategories}
                onClick={closeDrawer}
              >
                <AdminIcon name="close" />
              </button>
            </header>
            <nav className="mobile-category-menu__drawer-content">
              <a
                className={
                  properties.selectedCategoryId === null
                    ? 'category-button category-button--active'
                    : 'category-button'
                }
                href={cookbookPath(properties.tenantSlug, properties.categories, null, null)}
                onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                  properties.onCategoryNavigate(
                    event,
                    cookbookPath(properties.tenantSlug, properties.categories, null, null),
                  );
                  closeDrawer();
                }}
              >
                {properties.text.dashboard.featuredRecipes}
              </a>
              <CategoryTree
                categories={properties.categories}
                selectedCategoryId={properties.selectedCategoryId}
                text={properties.text}
                tenantSlug={properties.tenantSlug}
                onCategoryNavigate={properties.onCategoryNavigate}
                onNavigate={closeDrawer}
              />
            </nav>
          </aside>
        </>
      ) : null}
    </div>
  );
}
