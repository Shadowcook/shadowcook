import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';

interface EditorRecipe {
  publicId: string;
  title: string;
}

interface RecipeLinkPickerProperties {
  tenantSlug: string;
  initialSearch: string;
  text: Translation;
  onSelect: (recipe: EditorRecipe) => void;
}

const searchDelayMilliseconds: number = 300;

export default function RecipeLinkPicker(properties: RecipeLinkPickerProperties): JSX.Element {
  const [search, setSearch] = useState<string>(properties.initialSearch);
  const [recipes, setRecipes] = useState<EditorRecipe[]>([]);
  const [searchFailed, setSearchFailed] = useState<boolean>(false);

  useEffect((): void => {
    setSearch(properties.initialSearch);
  }, [properties.initialSearch]);

  useEffect((): (() => void) => {
    let isCurrent: boolean = true;
    const timeoutId: number = window.setTimeout((): void => {
      void request<{ recipes: EditorRecipe[] }>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/editor-catalogue/recipes?search=${encodeURIComponent(search.trim())}`,
      )
        .then((response): void => {
          if (!isCurrent) return;
          setRecipes(response.recipes);
          setSearchFailed(false);
        })
        .catch((): void => {
          if (!isCurrent) return;
          setRecipes([]);
          setSearchFailed(true);
        });
    }, search.length === 0 ? 0 : searchDelayMilliseconds);
    return (): void => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [properties.tenantSlug, search]);

  return (
    <div className="recipe-link-picker" role="dialog" aria-label={properties.text.recipeEditor.recipeLinkPicker}>
      <input
        autoFocus
        value={search}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => setSearch(event.currentTarget.value)}
        placeholder={properties.text.recipeEditor.searchRecipes}
        aria-label={properties.text.recipeEditor.searchRecipes}
      />
      <ul>
        {recipes.map((recipe: EditorRecipe): JSX.Element => (
          <li key={recipe.publicId}>
            <button type="button" onClick={(): void => properties.onSelect(recipe)}>
              {recipe.title}
            </button>
          </li>
        ))}
      </ul>
      {searchFailed ? <p role="alert">{properties.text.errors.requestFailed}</p> : null}
      {!searchFailed && recipes.length === 0 ? <p>{properties.text.recipeEditor.noRecipesFound}</p> : null}
    </div>
  );
}
