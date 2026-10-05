import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';
import { request } from '../../../lib/api/client';
import type { Recipe, RecipeManagementResponse } from '../model/types';
import RecipePagination from './RecipePagination';

interface RecipeManagementListProperties {
  locale: Locale;
  tenantSlug: string;
  onEdit: (publicId: string) => void;
  onCreate: () => void;
}

export default function RecipeManagementList(
  properties: RecipeManagementListProperties,
): JSX.Element {
  const text: Translation = translations[properties.locale];
  const [response, setResponse] = useState<RecipeManagementResponse | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasLoadFailed, setHasLoadFailed] = useState<boolean>(false);
  const requestSequence = useRef<number>(0);

  async function loadRecipes(page: number, nextFilter: string): Promise<void> {
    const sequence: number = requestSequence.current + 1;
    requestSequence.current = sequence;
    setIsLoading(true);
    setHasLoadFailed(false);
    setResponse(null);
    try {
      const result: RecipeManagementResponse = await request<RecipeManagementResponse>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes?page=${page}&filter=${encodeURIComponent(nextFilter)}`,
      );
      if (sequence === requestSequence.current) setResponse(result);
    } catch (_error: unknown) {
      if (sequence === requestSequence.current) setHasLoadFailed(true);
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }

  useEffect((): void => {
    void loadRecipes(1, '');
  }, [properties.tenantSlug]);

  function changeFilter(event: ChangeEvent<HTMLInputElement>): void {
    const nextFilter: string = event.target.value;
    setFilter(nextFilter);
    void loadRecipes(1, nextFilter);
  }

  const recipes: Recipe[] = response?.recipes ?? [];
  return (
    <section className="recipe-editor">
      <p className="eyebrow">{text.dashboard.recipes}</p>
      <h1>{text.dashboard.recipes}</h1>
      <button type="button" onClick={properties.onCreate}>
        {text.recipeEditor.create}
      </button>
      <label className="recipe-filter">
        <span>{text.dashboard.filterRecipes}</span>
        <input type="search" value={filter} onChange={changeFilter} />
      </label>
      {isLoading ? (
        <p className="empty-state" aria-live="polite">
          {text.loading}
        </p>
      ) : hasLoadFailed ? (
        <p className="message" role="alert">
          {text.errors.requestFailed}
        </p>
      ) : recipes.length === 0 ? (
        <p className="empty-state">{text.dashboard.noRecipes}</p>
      ) : (
        <ul className="draft-list">
          {recipes.map((recipe: Recipe): JSX.Element => (
            <li key={recipe.public_id}>
              <div>
                <strong>{recipe.title}</strong>
                {recipe.summary === null ? null : <span>{recipe.summary}</span>}
              </div>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => properties.onEdit(recipe.public_id)}
                aria-label={text.recipeEditor.edit}
                title={text.recipeEditor.edit}
              >
                <AdminIcon name="edit" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {response !== null && response.totalPages > 1 ? (
        <RecipePagination
          currentPage={response.page}
          totalPages={response.totalPages}
          text={text}
          onSelectPage={(page: number): Promise<void> => loadRecipes(page, filter)}
        />
      ) : null}
    </section>
  );
}
