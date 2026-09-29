import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import type { RecipeDetail } from '../model/types';
import RecipeDetailView from './RecipeDetailView';

interface SharedRecipe extends RecipeDetail {
  tenant_slug: string;
}

interface SharedRecipeViewProperties {
  token: string;
  text: Translation;
}
export default function SharedRecipeView({ token, text }: SharedRecipeViewProperties): JSX.Element {
  const [recipe, setRecipe] = useState<SharedRecipe | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  useEffect((): void => {
    void request<SharedRecipe>(`/cookbook/share-links/${encodeURIComponent(token)}`)
      .then(setRecipe)
      .catch((): void => setFailed(true));
  }, [token]);
  if (failed)
    return (
      <section className="recipe-editor">
        <p className="message" role="alert">
          {text.errors.requestFailed}
        </p>
      </section>
    );
  if (recipe === null)
    return (
      <section className="recipe-editor">
        <p className="empty-state">{text.loading}</p>
      </section>
    );
  return (
    <RecipeDetailView
      text={text}
      recipe={recipe}
      onClose={(): void => window.location.assign(`/${recipe.tenant_slug}`)}
      onEdit={(): void => undefined}
      onShare={(): void => undefined}
      onSelectVariant={(): void => undefined}
    />
  );
}
