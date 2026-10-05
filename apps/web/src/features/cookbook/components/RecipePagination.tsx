import type { JSX } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import { frontpagePaginationItems } from '../model/pagination';
import type { PaginationItem } from '../model/pagination';

interface RecipePaginationProperties {
  currentPage: number;
  totalPages: number;
  text: Translation;
  onSelectPage: (page: number) => void | Promise<void>;
}

export default function RecipePagination(properties: RecipePaginationProperties): JSX.Element {
  const pages: PaginationItem[] = frontpagePaginationItems(
    properties.currentPage,
    properties.totalPages,
  );
  return (
    <nav className="recipe-pagination" aria-label={properties.text.dashboard.recipes}>
      <button
        type="button"
        className="recipe-pagination__control"
        disabled={properties.currentPage === 1}
        aria-label={properties.text.dashboard.previousPage}
        title={properties.text.dashboard.previousPage}
        onClick={(): void => void properties.onSelectPage(properties.currentPage - 1)}
      >
        <AdminIcon name="previous" />
      </button>
      <div className="recipe-pagination__pages">
        {pages.map((page: PaginationItem, index: number): JSX.Element =>
          page === null ? (
            <span
              className="recipe-pagination__ellipsis"
              key={`ellipsis-${index}`}
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              type="button"
              className={
                page === properties.currentPage
                  ? 'recipe-pagination__page recipe-pagination__page--active'
                  : 'recipe-pagination__page'
              }
              key={page}
              aria-current={page === properties.currentPage ? 'page' : undefined}
              aria-label={`${properties.text.dashboard.page} ${page}`}
              onClick={(): void => void properties.onSelectPage(page)}
            >
              {page}
            </button>
          ),
        )}
      </div>
      <button
        type="button"
        className="recipe-pagination__control"
        disabled={properties.currentPage === properties.totalPages}
        aria-label={properties.text.dashboard.nextPage}
        title={properties.text.dashboard.nextPage}
        onClick={(): void => void properties.onSelectPage(properties.currentPage + 1)}
      >
        <AdminIcon name="next" />
      </button>
    </nav>
  );
}
