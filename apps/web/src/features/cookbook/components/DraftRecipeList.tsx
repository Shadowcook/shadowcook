import RecipeDeleteButton from './RecipeDeleteButton';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import AdminIcon from '../../../components/AdminIcon';
import type { EditableRecipe } from '../model/types';
import RecipeDraftDiscardButton from './RecipeDraftDiscardButton';

interface DraftRecipeListProperties {
  locale: Locale;
  tenantSlug: string;
  canCreateRecipes: boolean;
  canDeleteRecipes: boolean;
  onEdit: (publicId: string) => void;
  onCreate: () => void;
  onChanged: () => Promise<unknown>;
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
      {properties.canCreateRecipes ? (
        <button
          type="button"
          className="recipe-management__create-button"
          onClick={properties.onCreate}
        >
          {text.recipeEditor.create}
        </button>
      ) : null}
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
              <RecipeDraftDiscardButton
                text={text}
                tenantSlug={properties.tenantSlug}
                recipe={recipe}
                onDiscarded={async (): Promise<void> => {
                  setRecipes((current: EditableRecipe[]): EditableRecipe[] =>
                    current.filter(
                      (item: EditableRecipe): boolean => item.publicId !== recipe.publicId,
                    ),
                  );
                  await properties.onChanged();
                }}
              />
              <span className="draft-list__actions">
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => properties.onEdit(recipe.publicId)}
                  aria-label={text.recipeEditor.edit}
                  title={text.recipeEditor.edit}
                >
                  <AdminIcon name="edit" />
                </button>
                {properties.canDeleteRecipes ? (
                  <RecipeDeleteButton
                    text={text}
                    tenantSlug={properties.tenantSlug}
                    publicId={recipe.publicId}
                    title={recipe.title}
                    onDeleted={async (): Promise<void> => {
                      setRecipes((current: EditableRecipe[]): EditableRecipe[] =>
                        current.filter(
                          (item: EditableRecipe): boolean => item.publicId !== recipe.publicId,
                        ),
                      );
                      await properties.onChanged();
                    }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
