import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from './api-client';
import { recipeSpecialEntries } from './RecipeSpecialEntries';

interface Ingredient {
  publicId: string;
  name: string;
}

interface IngredientPickerProperties {
  tenantSlug: string;
  ingredientPublicId: string;
  ingredientName: string;
  textOverride: string;
  specialKind: string;
  text: Translation;
  onChange: (patch: IngredientPickerPatch) => void;
}

export interface IngredientPickerPatch {
  ingredientPublicId: string;
  ingredientName: string;
  textOverride: string;
  specialKind: string;
}

const searchDelayMilliseconds: number = 300;

export default function IngredientPicker(properties: IngredientPickerProperties): JSX.Element {
  const [search, setSearch] = useState<string>('');
  const [results, setResults] = useState<Ingredient[]>([]);
  const [searchFailed, setSearchFailed] = useState<boolean>(false);
  const pickerReference = useRef<HTMLDetailsElement>(null);

  useEffect((): (() => void) | undefined => {
    const normalizedSearch: string = search.trim();
    if (normalizedSearch.length === 0) {
      setResults([]);
      setSearchFailed(false);
      return undefined;
    }
    let isCurrent: boolean = true;
    const timeoutId: number = window.setTimeout((): void => {
      void request<{ ingredients: Ingredient[] }>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/editor-catalogue/ingredients?search=${encodeURIComponent(normalizedSearch)}`,
      )
        .then((response): void => {
          if (!isCurrent) return;
          setResults(response.ingredients);
          setSearchFailed(false);
        })
        .catch((): void => {
          if (!isCurrent) return;
          setResults([]);
          setSearchFailed(true);
        });
    }, searchDelayMilliseconds);
    return (): void => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [properties.tenantSlug, search]);

  function selectIngredient(ingredient: Ingredient): void {
    properties.onChange({
      ingredientPublicId: ingredient.publicId,
      ingredientName: ingredient.name,
      textOverride: '',
      specialKind: '',
    });
    setSearch('');
    setResults([]);
    closePicker();
  }

  function selectFreeText(): void {
    properties.onChange({
      ingredientPublicId: '',
      ingredientName: '',
      textOverride: '',
      specialKind: '',
    });
    setSearch('');
    closePicker();
  }

  function selectSpecialEntry(specialKind: string): void {
    properties.onChange({
      ingredientPublicId: '',
      ingredientName: '',
      textOverride: '',
      specialKind,
    });
    setSearch('');
    closePicker();
  }

  function closePicker(): void {
    if (pickerReference.current !== null) pickerReference.current.open = false;
  }

  const selectedLabel: string = selectionLabel(properties);

  return (
    <details className="ingredient-picker" ref={pickerReference}>
      <summary>{selectedLabel}</summary>
      <div className="ingredient-picker__menu">
        <input
          type="search"
          value={search}
          onChange={(event): void => setSearch(event.currentTarget.value)}
          placeholder={properties.text.recipeEditor.searchIngredients}
          aria-label={properties.text.recipeEditor.searchIngredients}
        />
        {search.trim().length > 0 ? (
          <ul className="ingredient-picker__results">
            {results.map((ingredient: Ingredient): JSX.Element => (
              <li key={ingredient.publicId}>
                <button type="button" onClick={(): void => selectIngredient(ingredient)}>
                  {ingredient.name}
                </button>
              </li>
            ))}
            {!searchFailed && results.length === 0 ? (
              <li className="ingredient-picker__empty">
                {properties.text.recipeEditor.noIngredientsFound}
              </li>
            ) : null}
            {searchFailed ? (
              <li className="ingredient-picker__empty">{properties.text.errors.requestFailed}</li>
            ) : null}
          </ul>
        ) : null}
        <div className="ingredient-picker__special-entries">
          <button type="button" className="button--secondary" onClick={selectFreeText}>
            {properties.text.recipeEditor.freeText}
          </button>
          {recipeSpecialEntries(properties.text).map((entry): JSX.Element => (
            <button
              type="button"
              className="button--secondary"
              key={entry.kind}
              onClick={(): void => selectSpecialEntry(entry.kind)}
            >
              {entry.icon} {entry.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

function selectionLabel(properties: IngredientPickerProperties): string {
  if (properties.ingredientPublicId.length > 0) return properties.ingredientName;
  if (properties.specialKind.length > 0) {
    const entry = recipeSpecialEntries(properties.text).find(
      (candidate): boolean => candidate.kind === properties.specialKind,
    );
    return entry === undefined
      ? properties.text.recipeEditor.specialEntry
      : `${entry.icon} ${entry.label}`.trim();
  }
  if (properties.textOverride.length > 0) return properties.text.recipeEditor.freeText;
  return properties.text.recipeEditor.selectIngredient;
}
