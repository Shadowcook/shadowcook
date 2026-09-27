import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { request } from './api-client';
import type { EditableRecipe } from './cookbook-types';

interface DraftRecipeListProperties {
  locale: Locale;
  tenantSlug: string;
  onEdit: (publicId: string) => void;
  onCreate: () => void;
}
export default function DraftRecipeList(properties: DraftRecipeListProperties): JSX.Element {
  const text: Translation = translations[properties.locale];
  const [recipes, setRecipes] = useState<EditableRecipe[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  useEffect((): void => {
    void request<{ recipes: EditableRecipe[] }>(
      `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/drafts`,
    )
      .then((response: { recipes: EditableRecipe[] }): void => setRecipes(response.recipes))
      .finally((): void => setIsLoading(false));
  }, [properties.tenantSlug]);
  return (
    <section className="recipe-editor">
      <p className="eyebrow">{text.recipeEditor.drafts}</p>
      <h1>{text.recipeEditor.draftsTitle}</h1>
      <p className="lede">{text.recipeEditor.draftsDescription}</p>
      <button type="button" onClick={properties.onCreate}>
        {text.recipeEditor.create}
      </button>
      {isLoading ? (
        <p className="empty-state">{text.loading}</p>
      ) : recipes.length === 0 ? (
        <p className="empty-state">{text.recipeEditor.noDrafts}</p>
      ) : (
        <ul className="draft-list">
          {recipes.map((recipe: EditableRecipe): JSX.Element => (
            <li key={recipe.publicId}>
              <div>
                <strong>{recipe.title}</strong>
                <span>
                  {recipe.hasPublishedRevision
                    ? `${text.recipeEditor.version}: ${recipe.publishedVersion}`
                    : text.recipeEditor.create}
                </span>
              </div>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => properties.onEdit(recipe.publicId)}
              >
                {text.recipeEditor.edit}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
