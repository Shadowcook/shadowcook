import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import ErrorState from '../../../components/errors/ErrorState';
import { ApiRequestError, request } from '../../../lib/api/client';
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
  const [failure, setFailure] = useState<ApiRequestError | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  useEffect((): void => {
    void request<SharedRecipe>(`/cookbook/share-links/${encodeURIComponent(token)}`)
      .then((loaded: SharedRecipe): void => {
        setRecipe(loaded);
        setFailure(null);
      })
      .catch((error: unknown): void =>
        setFailure(error instanceof ApiRequestError ? error : new ApiRequestError('NETWORK_ERROR')),
      );
  }, [token, attempt]);
  if (failure !== null)
    return (
      <ErrorState
        text={text.errorStates}
        status={failure.status}
        network={failure.status === undefined}
        requestId={failure.requestId}
        retryAfterSeconds={failure.retryAfterSeconds}
        onRetry={(): void => setAttempt(attempt + 1)}
      />
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
      backHref={`/${encodeURIComponent(recipe.tenant_slug)}`}
      onEdit={(): void => undefined}
      onShare={(): void => undefined}
      onShareWithAi={(): void => undefined}
      onSelectVariant={(): void => undefined}
      tenantSlug={recipe.tenant_slug}
      shareToken={token}
    />
  );
}
