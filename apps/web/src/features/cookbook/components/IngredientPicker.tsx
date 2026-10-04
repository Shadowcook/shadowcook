import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import { recipeSpecialEntries } from '../model/special-entries';
import SpecialIngredientIcon from './SpecialIngredientIcon';

interface Ingredient {
  publicId: string;
  name: string;
  exactMatch: boolean;
}

interface CreatedIngredient {
  publicId: string;
  canonicalName: string;
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
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newIngredientName, setNewIngredientName] = useState<string>('');
  const [newAliases, setNewAliases] = useState<string[]>([]);
  const [creationMessage, setCreationMessage] = useState<string>('');
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

  function openCreateIngredient(): void {
    setNewIngredientName(search.trim());
    setNewAliases([]);
    setCreationMessage('');
    setIsCreating(true);
  }

  async function createIngredient(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      `/api/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/ingredients`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonicalName: newIngredientName, aliases: newAliases }),
      },
    );
    if (!response.ok) {
      setCreationMessage(properties.text.errors.requestFailed);
      return;
    }
    const ingredient: CreatedIngredient = (await response.json()) as CreatedIngredient;
    selectIngredient({
      publicId: ingredient.publicId,
      name: ingredient.canonicalName,
      exactMatch: true,
    });
    setIsCreating(false);
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
  const selectedSpecialEntry = recipeSpecialEntries(properties.text).find(
    (entry): boolean => entry.kind === properties.specialKind,
  );
  const hasExactMatch: boolean = results.some(
    (ingredient: Ingredient): boolean => ingredient.exactMatch,
  );

  return (
    <details className="ingredient-picker" ref={pickerReference}>
      <summary aria-label={selectedLabel} title={selectedLabel}>
        {selectedSpecialEntry === undefined ? (
          selectedLabel
        ) : (
          <SpecialIngredientIcon kind={selectedSpecialEntry.kind} />
        )}
      </summary>
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
            {!searchFailed && !hasExactMatch ? (
              <li>
                <button type="button" onClick={openCreateIngredient}>
                  {properties.text.recipeEditor.createIngredient}: {search.trim()}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        <div className="ingredient-picker__special-entries">
          <button type="button" className="button--secondary" onClick={selectFreeText}>
            {properties.text.recipeEditor.freeText}
          </button>
          {recipeSpecialEntries(properties.text)
            .filter((entry): boolean => entry.kind !== 'NO_ICON')
            .map((entry): JSX.Element => (
              <button
                type="button"
                className="button--secondary ingredient-picker__special-entry"
                key={entry.kind}
                onClick={(): void => selectSpecialEntry(entry.kind)}
                aria-label={entry.label}
                title={entry.label}
              >
                <SpecialIngredientIcon kind={entry.kind} />
              </button>
            ))}
        </div>
      </div>
      {!isCreating ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="create-ingredient-title">
            <h2 id="create-ingredient-title">{properties.text.recipeEditor.createIngredient}</h2>
            <p>{properties.text.recipeEditor.createIngredientDescription}</p>
            {creationMessage.length > 0 ? (
              <p className="message" role="status">
                {creationMessage}
              </p>
            ) : null}
            <form
              onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void createIngredient(event)}
            >
              <label>
                {properties.text.tenantIngredients.name}
                <input
                  required
                  autoFocus
                  value={newIngredientName}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setNewIngredientName(event.currentTarget.value)
                  }
                />
              </label>
              <fieldset>
                <legend>{properties.text.recipeEditor.ingredientAliases}</legend>
                {newAliases.map((alias: string, index: number): JSX.Element => (
                  <div className="ingredient-form__alias" key={index}>
                    <input
                      aria-label={properties.text.recipeEditor.ingredientAlias}
                      required
                      value={alias}
                      onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                        setNewAliases(
                          newAliases.map((candidate: string, aliasIndex: number): string =>
                            aliasIndex === index ? event.currentTarget.value : candidate,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="button--secondary"
                      onClick={(): void =>
                        setNewAliases(
                          newAliases.filter(
                            (_candidate: string, aliasIndex: number): boolean =>
                              aliasIndex !== index,
                          ),
                        )
                      }
                    >
                      {properties.text.dashboard.delete}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => setNewAliases([...newAliases, ''])}
                >
                  {properties.text.tenantIngredients.addAlias}
                </button>
              </fieldset>
              <button type="submit">{properties.text.recipeEditor.createIngredientSubmit}</button>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => setIsCreating(false)}
              >
                {properties.text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
    </details>
  );
}

function selectionLabel(properties: IngredientPickerProperties): string {
  if (properties.ingredientPublicId.length > 0) return properties.ingredientName;
  if (properties.specialKind.length > 0) {
    const entry = recipeSpecialEntries(properties.text).find(
      (candidate): boolean => candidate.kind === properties.specialKind,
    );
    return entry === undefined ? properties.text.recipeEditor.specialEntry : entry.label;
  }
  if (properties.textOverride.length > 0) return properties.text.recipeEditor.freeText;
  return properties.text.recipeEditor.selectIngredient;
}
