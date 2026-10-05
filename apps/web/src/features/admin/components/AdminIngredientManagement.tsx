import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { localizedIngredientName } from '../../../i18n/ingredient-localization';
import AdminIcon from '../../../components/AdminIcon';
import IngredientConsolidationModal from '../../cookbook/components/IngredientConsolidationModal';

interface IngredientAlias {
  publicId: string;
  alias: string;
  localizationKey: string | null;
}

interface Ingredient {
  publicId: string;
  canonicalName: string;
  localizationKey: string | null;
  usageCount: number;
  aliases: IngredientAlias[];
}

type ConsolidationAction = 'convert-to-alias' | 'merge';

interface IngredientConsolidation {
  source: Ingredient;
  action: ConsolidationAction;
}

export default function AdminIngredientManagement({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [name, setName] = useState<string>('');
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [aliasesFor, setAliasesFor] = useState<Ingredient | null>(null);
  const [editingAlias, setEditingAlias] = useState<IngredientAlias | null>(null);
  const [aliasName, setAliasName] = useState<string>('');
  const [consolidation, setConsolidation] = useState<IngredientConsolidation | null>(null);
  const [message, setMessage] = useState<string>('');

  function refresh(): void {
    void loadIngredients(setIngredients);
  }
  function closeIngredientEdit(): void {
    setEditing(null);
    setEditingName('');
  }
  function openIngredientEdit(ingredient: Ingredient): void {
    setEditing(ingredient);
    setEditingName(ingredient.canonicalName);
  }
  async function createIngredient(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch('/api/admin/ingredients', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalName: name }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(text.admin.ingredientCreated);
    setName('');
    refresh();
  }
  async function saveIngredientEdit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editing === null) return;
    const response: Response = await fetch(`/api/admin/ingredients/${editing.publicId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalName: editingName }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(text.admin.ingredientUpdated);
    closeIngredientEdit();
    refresh();
  }
  async function removeIngredient(ingredient: Ingredient): Promise<void> {
    const response: Response = await fetch(`/api/admin/ingredients/${ingredient.publicId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setMessage(response.ok ? text.admin.ingredientDeleted : text.admin.ingredientCannotDelete);
    if (response.ok) refresh();
  }
  async function consolidateIngredient(targetPublicId: string): Promise<void> {
    if (consolidation === null) return;
    const response: Response = await fetch(
      `/api/admin/ingredients/${consolidation.source.publicId}/${consolidation.action}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPublicId }),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(
      consolidation.action === 'convert-to-alias'
        ? text.admin.ingredientConvertedToAlias
        : text.admin.ingredientMerged,
    );
    setConsolidation(null);
    refresh();
  }
  function openAliases(ingredient: Ingredient): void {
    setAliasesFor(ingredient);
    setEditingAlias(null);
    setAliasName('');
  }
  function closeAliases(): void {
    setAliasesFor(null);
    setEditingAlias(null);
    setAliasName('');
  }
  async function saveAlias(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (aliasesFor === null) return;
    const path: string =
      editingAlias === null
        ? `/api/admin/ingredients/${aliasesFor.publicId}/aliases`
        : `/api/admin/ingredients/${aliasesFor.publicId}/aliases/${editingAlias.publicId}`;
    const response: Response = await fetch(path, {
      method: editingAlias === null ? 'POST' : 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: aliasName }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(editingAlias === null ? text.admin.aliasCreated : text.admin.aliasUpdated);
    setEditingAlias(null);
    setAliasName('');
    refresh();
  }
  async function removeAlias(alias: IngredientAlias): Promise<void> {
    if (aliasesFor === null) return;
    const response: Response = await fetch(
      `/api/admin/ingredients/${aliasesFor.publicId}/aliases/${alias.publicId}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (response.ok) {
      setMessage(text.admin.aliasDeleted);
      refresh();
    } else setMessage(text.errors.requestFailed);
  }

  useEffect(refresh, []);
  const activeAliases: Ingredient | null =
    aliasesFor === null
      ? null
      : (ingredients.find(
          (ingredient: Ingredient): boolean => ingredient.publicId === aliasesFor.publicId,
        ) ?? aliasesFor);
  return (
    <section className="admin-page admin-page--wide">
      <div className="dashboard__header">
        <div>
          <p className="eyebrow">{text.dashboard.ingredients}</p>
          <h1>{text.admin.ingredientsTitle}</h1>
        </div>
      </div>
      <p className="lede">{text.admin.ingredientsDescription}</p>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="ingredient-form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void createIngredient(event)}
      >
        <h2>{text.admin.createIngredient}</h2>
        <label>
          {text.admin.ingredientName}
          <input
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setName(event.currentTarget.value)
            }
            required
          />
        </label>
        <div>
          <button type="submit">{text.admin.save}</button>
        </div>
      </form>
      <div className="unit-table-container">
        <table className="tenant-table ingredient-table">
          <thead>
            <tr>
              <th>{text.admin.ingredientName}</th>
              <th>{text.admin.ingredientAliases}</th>
              <th>{text.admin.ingredientUsage}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ingredient: Ingredient): JSX.Element => (
              <tr key={ingredient.publicId}>
                <td>
                  {localizedIngredientName(
                    text,
                    ingredient.localizationKey,
                    ingredient.canonicalName,
                  )}
                </td>
                <td>
                  {ingredient.aliases
                    .map((alias: IngredientAlias): string =>
                      localizedIngredientName(text, alias.localizationKey, alias.alias),
                    )
                    .join(', ')}
                </td>
                <td>{ingredient.usageCount}</td>
                <td>
                  <div className="tenant-actions">
                    <button
                      aria-label={text.admin.manageAliases}
                      title={text.admin.manageAliases}
                      onClick={(): void => openAliases(ingredient)}
                    >
                      <AdminIcon name="aliases" />
                    </button>
                    <button
                      aria-label={text.dashboard.rename}
                      title={text.dashboard.rename}
                      onClick={(): void => openIngredientEdit(ingredient)}
                    >
                      <AdminIcon name="edit" />
                    </button>
                    <button
                      aria-label={text.admin.convertToAlias}
                      title={text.admin.convertToAlias}
                      onClick={(): void =>
                        setConsolidation({ source: ingredient, action: 'convert-to-alias' })
                      }
                    >
                      <AdminIcon name="aliases" />
                    </button>
                    <button
                      aria-label={text.admin.mergeIngredient}
                      title={text.admin.mergeIngredient}
                      onClick={(): void =>
                        setConsolidation({ source: ingredient, action: 'merge' })
                      }
                    >
                      <AdminIcon name="consolidate" />
                    </button>
                    <button
                      aria-label={text.dashboard.delete}
                      title={
                        ingredient.usageCount > 0
                          ? text.admin.ingredientCannotDelete
                          : text.dashboard.delete
                      }
                      disabled={ingredient.usageCount > 0}
                      onClick={(): void => void removeIngredient(ingredient)}
                    >
                      <AdminIcon name="delete" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="edit-ingredient-title">
            <h2 id="edit-ingredient-title">{text.admin.editIngredient}</h2>
            <form
              onSubmit={(event: SubmitEvent<HTMLFormElement>): void =>
                void saveIngredientEdit(event)
              }
            >
              <label>
                {text.admin.ingredientName}
                <input
                  value={editingName}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setEditingName(event.currentTarget.value)
                  }
                  required
                  autoFocus
                />
              </label>
              <button type="submit">{text.admin.save}</button>
              <button type="button" className="button--secondary" onClick={closeIngredientEdit}>
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
      {activeAliases === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="aliases-title">
            <h2 id="aliases-title">
              {text.admin.manageAliases}:{' '}
              {localizedIngredientName(
                text,
                activeAliases.localizationKey,
                activeAliases.canonicalName,
              )}
            </h2>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void saveAlias(event)}>
              <label>
                {text.admin.aliasName}
                <input
                  value={aliasName}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setAliasName(event.currentTarget.value)
                  }
                  required
                />
              </label>
              <button type="submit">
                {editingAlias === null ? text.admin.addAlias : text.admin.save}
              </button>
              {editingAlias === null ? null : (
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => {
                    setEditingAlias(null);
                    setAliasName('');
                  }}
                >
                  {text.admin.cancel}
                </button>
              )}
            </form>
            <ul className="alias-list">
              {activeAliases.aliases.map((alias: IngredientAlias): JSX.Element => (
                <li key={alias.publicId}>
                  <span>{localizedIngredientName(text, alias.localizationKey, alias.alias)}</span>
                  <div className="tenant-actions">
                    <button
                      aria-label={text.dashboard.rename}
                      title={text.admin.editAlias}
                      onClick={(): void => {
                        setEditingAlias(alias);
                        setAliasName(alias.alias);
                      }}
                    >
                      <AdminIcon name="edit" />
                    </button>
                    <button
                      aria-label={text.dashboard.delete}
                      title={text.dashboard.delete}
                      onClick={(): void => void removeAlias(alias)}
                    >
                      <AdminIcon name="delete" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="button--secondary" onClick={closeAliases}>
              {text.admin.cancel}
            </button>
          </section>
        </div>
      )}
      {consolidation === null ? null : (
        <IngredientConsolidationModal
          source={consolidation.source}
          ingredients={ingredients}
          text={{
            title:
              consolidation.action === 'convert-to-alias'
                ? text.admin.convertToAliasTitle
                : text.admin.mergeIngredientTitle,
            description:
              consolidation.action === 'convert-to-alias'
                ? text.admin.convertToAliasDescription
                : text.admin.mergeIngredientDescription,
            target: text.admin.consolidationTarget,
            submit:
              consolidation.action === 'convert-to-alias'
                ? text.admin.convertToAlias
                : text.admin.mergeIngredient,
            cancel: text.admin.cancel,
          }}
          ingredientName={(publicId: string): string => {
            const ingredient: Ingredient | undefined = ingredients.find(
              (candidate: Ingredient): boolean => candidate.publicId === publicId,
            );
            return ingredient === undefined
              ? ''
              : localizedIngredientName(text, ingredient.localizationKey, ingredient.canonicalName);
          }}
          onSubmit={consolidateIngredient}
          onClose={(): void => setConsolidation(null)}
        />
      )}
    </section>
  );
}

async function loadIngredients(setIngredients: (ingredients: Ingredient[]) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/ingredients', { credentials: 'same-origin' });
  if (response.ok)
    setIngredients(((await response.json()) as { ingredients: Ingredient[] }).ingredients);
}
