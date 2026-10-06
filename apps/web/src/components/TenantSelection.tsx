import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import RecipePagination from '../features/cookbook/components/RecipePagination';
import type { CookbookTenant } from '../features/cookbook/model/types';

interface TenantSelectionProperties {
  locale: Locale;
}

interface TenantSelectionResponse {
  siteName: string;
  slogan: string;
  cookbooksPerPage: number;
  tenants: CookbookTenant[];
  page: number;
  totalPages: number;
  totalTenants: number;
  shuffleSeed: string;
}

export default function TenantSelection({ locale }: TenantSelectionProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [selection, setSelection] = useState<TenantSelectionResponse | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [shuffleSeed, setShuffleSeed] = useState<string>('');
  const [error, setError] = useState<string>('');
  useEffect((): void => {
    void loadTenants(page, filter, shuffleSeed)
      .then((response: TenantSelectionResponse): void => {
        setSelection(response);
        setShuffleSeed(response.shuffleSeed);
        setError('');
      })
      .catch((): void => setError(text.errors.requestFailed));
  }, [page, filter, shuffleSeed, text.errors.requestFailed]);
  return (
    <section className="dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow dashboard__cookbook-name">
            {selection?.siteName ?? text.dashboard.cookbook}
          </p>
          <h1>{selection?.slogan ?? text.dashboard.rootSlogan}</h1>
        </div>
      </header>
      {error.length > 0 ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      <section className="recipes-panel tenant-selection">
        <div className="recipes-panel__heading">
          <p className="eyebrow">{text.dashboard.cookbooks}</p>
          <strong>{selection?.totalTenants ?? 0}</strong>
        </div>
        <label className="recipe-filter">
          <span>{text.dashboard.filterTenants}</span>
          <input
            type="search"
            value={filter}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setFilter(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        {selection === null ? (
          <p className="empty-state" aria-live="polite">
            {text.loading}
          </p>
        ) : selection.tenants.length === 0 ? (
          <p className="empty-state">{text.dashboard.noCookbooks}</p>
        ) : (
          <div className="recipe-grid">
            {selection.tenants.map((tenant: CookbookTenant): JSX.Element => (
              <article className="recipe-card" key={tenant.public_id}>
                <a className="recipe-card__button" href={`/${encodeURIComponent(tenant.slug)}`}>
                  <h2>{tenant.display_name}</h2>
                  {tenant.description === null ? null : <p>{tenant.description}</p>}
                  <div className="recipe-card__categories">
                    <span>
                      {tenant.recipe_count} {text.dashboard.recipesCount}
                    </span>
                  </div>
                </a>
              </article>
            ))}
          </div>
        )}
        {selection !== null && selection.totalPages > 1 ? (
          <RecipePagination
            currentPage={selection.page}
            totalPages={selection.totalPages}
            text={text}
            onSelectPage={setPage}
          />
        ) : null}
      </section>
    </section>
  );
}

async function loadTenants(
  page: number,
  filter: string,
  shuffleSeed: string,
): Promise<TenantSelectionResponse> {
  const parameters: URLSearchParams = new URLSearchParams({ page: String(page), filter });
  if (shuffleSeed.length > 0) parameters.set('shuffleSeed', shuffleSeed);
  const response: Response = await fetch(`/api/cookbook/tenants?${parameters.toString()}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Tenant selection request failed.');
  return (await response.json()) as TenantSelectionResponse;
}
