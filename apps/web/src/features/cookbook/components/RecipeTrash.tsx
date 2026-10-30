import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';

interface TrashRecipe {
  publicId: string;
  slug: string;
  title: string;
  deletedAt: string;
  expiresAt: string;
}
interface RecipeTrashProperties {
  text: Translation;
  tenantSlug: string;
  onChanged: () => Promise<unknown>;
}
export default function RecipeTrash({
  text,
  tenantSlug,
  onChanged,
}: RecipeTrashProperties): JSX.Element {
  const [recipes, setRecipes] = useState<TrashRecipe[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const path: string = `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/trash`;
  async function load(): Promise<void> {
    const response: { recipes: TrashRecipe[] } = await request<{ recipes: TrashRecipe[] }>(path);
    setRecipes(response.recipes);
  }
  useEffect((): void => {
    void load().catch((): void => setFailed(true));
  }, [tenantSlug]);
  async function restore(publicId: string): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await request<void>(`${path}/${publicId}/restore`, { method: 'POST' });
      await load();
      await onChanged();
    } catch (_error: unknown) {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="recipe-editor">
      <h1>{text.recipeTrash.title}</h1>
      {failed ? (
        <p className="message" role="alert">
          {text.errors.requestFailed}
        </p>
      ) : null}
      {recipes === null ? (
        failed ? null : (
          <p>{text.loading}</p>
        )
      ) : recipes.length === 0 ? (
        <p className="empty-state">{text.recipeTrash.empty}</p>
      ) : (
        <ul className="draft-list">
          {recipes.map((recipe: TrashRecipe): JSX.Element => (
            <li key={recipe.publicId} id={recipe.publicId}>
              <div>
                <strong>{recipe.title}</strong>
                <span>
                  {text.recipeTrash.expiresAt}:{' '}
                  <time dateTime={recipe.expiresAt}>
                    {new Date(recipe.expiresAt).toLocaleString(text.locale)}
                  </time>
                </span>
              </div>
              <button
                type="button"
                className="button--secondary"
                disabled={busy}
                onClick={(): void => void restore(recipe.publicId)}
              >
                {text.recipeTrash.restore}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
