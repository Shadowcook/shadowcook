import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { localizedIngredientName } from '../../../i18n/ingredient-localization';
import AdminIcon from '../../../components/AdminIcon';
import RequestErrorModal from '../../../components/RequestErrorModal';
import { ingredientRequestError } from '../../../lib/ingredient-request-error';
import IngredientConsolidationModal from '../../cookbook/components/IngredientConsolidationModal';
import type { IngredientManagementAction } from '../../cookbook/components/IngredientConsolidationModal';

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

interface IngredientConsolidation {
  source: Ingredient;
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
  const [errorMessage, setErrorMessage] = useState<string>('');

  function refresh(): void {
    void loadIngredients(setIngredients);
  }
  async function showRequestError(response: Response): Promise<void> {
    setErrorMessage(await ingredientRequestError(response, text));
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
      await showRequestError(response);
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
      await showRequestError(response);
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
    if (!response.ok) {
      await showRequestError(response);
      return;
    }
    setMessage(text.admin.ingredientDeleted);
    refresh();
  }
  async function consolidateIngredient(
    action: IngredientManagementAction,
    targetPublicId: string | null,
  ): Promise<void> {
    if (consolidation === null) return;
    const pathAction: string = action === 'make-alias' ? 'convert-to-alias' : action;
    const response: Response = await fetch(
      `/api/admin/ingredients/${consolidation.source.publicId}/${pathAction}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: targetPublicId === null ? undefined : { 'Content-Type': 'application/json' },
        body: targetPublicId === null ? undefined : JSON.stringify({ targetPublicId }),
      },
    );
    if (!response.ok) {
      await showRequestError(response);
      return;
    }
    setMessage(
      action === 'make-alias'
        ? text.admin.ingredientConvertedToAlias
        : action === 'merge'
          ? text.admin.ingredientMerged
          : text.admin.ingredientConvertedToNote,
    );
    setConsolidation(null);
    refresh();
  }
  async function separateAliasInConsolidation(aliasPublicId: string): Promise<void> {
    if (consolidation === null) return;
    const response: Response = await fetch(
      `/api/admin/ingredients/${consolidation.source.publicId}/aliases/${aliasPublicId}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!response.ok) {
      await showRequestError(response);
      return;
    }
    setMessage(text.admin.aliasSeparated);
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
      await showRequestError(response);
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
      setMessage(text.admin.aliasSeparated);
      refresh();
    } else await showRequestError(response);
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
      {errorMessage.length > 0 ? (
        <RequestErrorModal
          title={text.errors.title}
          message={errorMessage}
          dismiss={text.errors.dismiss}
          onClose={(): void => setErrorMessage('')}
        />
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
                      aria-label={text.admin.manageIngredient}
                      title={text.admin.manageIngredient}
                      onClick={(): void => setConsolidation({ source: ingredient })}
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
          aliases={consolidation.source.aliases}
          text={{
            title: text.admin.manageIngredient,
            description: text.admin.manageIngredientDescription,
            merge: text.admin.mergeIngredient,
            makeAlias: text.admin.makeAliasOf,
            convertToNote: text.admin.convertToNote,
            mergeDescription: text.admin.mergeIngredientDescription,
            makeAliasDescription: text.admin.makeAliasOfDescription,
            convertToNoteDescription: text.admin.convertToNoteDescription,
            aliases: text.admin.ingredientAliases,
            separateAlias: text.admin.separateAlias,
            mergeConfirmationTitle: text.admin.mergeConfirmationTitle,
            mergeIrreversible: text.admin.mergeIrreversible,
            sourceIngredient: text.admin.sourceIngredient,
            targetIngredient: text.admin.targetIngredient,
            confirmMerge: text.admin.confirmMerge,
            back: text.admin.cancel,
            target: text.admin.consolidationTarget,
            submit: text.admin.save,
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
          onSeparateAlias={separateAliasInConsolidation}
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
