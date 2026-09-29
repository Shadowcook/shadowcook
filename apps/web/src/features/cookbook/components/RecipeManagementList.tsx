import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';
import type { Recipe } from '../model/types';

interface RecipeManagementListProperties {
  text: Translation;
  recipes: Recipe[];
  onEdit: (publicId: string) => void;
  onCreate: () => void;
}

export default function RecipeManagementList(
  properties: RecipeManagementListProperties,
): JSX.Element {
  return (
    <section className="recipe-editor">
      <p className="eyebrow">{properties.text.dashboard.recipes}</p>
      <h1>{properties.text.dashboard.recipes}</h1>
      <button type="button" onClick={properties.onCreate}>
        {properties.text.recipeEditor.create}
      </button>
      {properties.recipes.length === 0 ? (
        <p className="empty-state">{properties.text.dashboard.noRecipes}</p>
      ) : (
        <ul className="draft-list">
          {properties.recipes.map((recipe: Recipe): JSX.Element => (
            <li key={recipe.public_id}>
              <div>
                <strong>{recipe.title}</strong>
                {recipe.summary === null ? null : <span>{recipe.summary}</span>}
              </div>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => properties.onEdit(recipe.public_id)}
                aria-label={properties.text.recipeEditor.edit}
                title={properties.text.recipeEditor.edit}
              >
                <AdminIcon name="edit" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
