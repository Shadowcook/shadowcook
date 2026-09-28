import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import AdminIcon from './AdminIcon';

interface IngredientAlias {
  publicId: string;
  alias: string;
}
interface Ingredient {
  publicId: string;
  canonicalName: string;
  usageCount: number;
  aliases: IngredientAlias[];
}
interface IngredientForm {
  canonicalName: string;
  aliases: string[];
}

const emptyForm: IngredientForm = { canonicalName: '', aliases: [] };

export default function TenantIngredientManagement({
  locale,
  tenantSlug,
}: {
  locale: Locale;
  tenantSlug: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [form, setForm] = useState<IngredientForm>(emptyForm);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [aliasName, setAliasName] = useState<string>('');
  const [aliasesFor, setAliasesFor] = useState<Ingredient | null>(null);
  const [message, setMessage] = useState<string>('');

  function endpoint(suffix: string = ''): string {
    return `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/ingredients${suffix}`;
  }
  function refresh(): void {
    void loadIngredients(endpoint(), setIngredients);
  }
  useEffect(refresh, [tenantSlug]);
  function closeForm(): void {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(false);
  }
  function openCreate(): void {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(ingredient: Ingredient): void {
    setEditing(ingredient);
    setForm({ canonicalName: ingredient.canonicalName, aliases: [] });
    setShowForm(true);
  }
  function updateAlias(index: number, value: string): void {
    setForm((current: IngredientForm): IngredientForm => ({
      ...current,
      aliases: current.aliases.map((alias: string, candidate: number): string =>
        candidate === index ? value : alias,
      ),
    }));
  }
  function removeFormAlias(index: number): void {
    setForm((current: IngredientForm): IngredientForm => ({
      ...current,
      aliases: current.aliases.filter(
        (_alias: string, candidate: number): boolean => candidate !== index,
      ),
    }));
  }

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const path: string = editing === null ? endpoint() : endpoint(`/${editing.publicId}`);
    const body: object = editing === null ? form : { canonicalName: form.canonicalName };
    const response: Response = await fetch(path, {
      method: editing === null ? 'POST' : 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(editing === null ? text.tenantIngredients.created : text.tenantIngredients.updated);
    closeForm();
    refresh();
  }
  async function removeIngredient(ingredient: Ingredient): Promise<void> {
    const response: Response = await fetch(endpoint(`/${ingredient.publicId}`), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setMessage(response.ok ? text.tenantIngredients.deleted : text.tenantIngredients.cannotDelete);
    if (response.ok) refresh();
  }
  async function addAlias(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (aliasesFor === null) return;
    const response: Response = await fetch(endpoint(`/${aliasesFor.publicId}/aliases`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: aliasName }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setAliasName('');
    setMessage(text.tenantIngredients.aliasCreated);
    refresh();
  }
  async function removeAlias(alias: IngredientAlias): Promise<void> {
    if (aliasesFor === null) return;
    const response: Response = await fetch(
      endpoint(`/${aliasesFor.publicId}/aliases/${alias.publicId}`),
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(text.tenantIngredients.aliasDeleted);
    refresh();
  }
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
          <p className="eyebrow">{text.tenantNavigation.ingredients}</p>
          <h1>{text.tenantIngredients.title}</h1>
        </div>
        <button type="button" onClick={openCreate}>
          {text.tenantIngredients.create}
        </button>
      </div>
      <p className="lede">{text.tenantIngredients.description}</p>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <div className="unit-table-container">
        <table className="tenant-table ingredient-table">
          <thead>
            <tr>
              <th>{text.tenantIngredients.name}</th>
              <th>{text.tenantIngredients.aliases}</th>
              <th>{text.tenantIngredients.usage}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ingredient: Ingredient): JSX.Element => (
              <tr key={ingredient.publicId}>
                <td>{ingredient.canonicalName}</td>
                <td>
                  {ingredient.aliases
                    .map((alias: IngredientAlias): string => alias.alias)
                    .join(', ')}
                </td>
                <td>{ingredient.usageCount}</td>
                <td>
                  <div className="tenant-actions">
                    <button
                      type="button"
                      aria-label={text.tenantIngredients.manageAliases}
                      title={text.tenantIngredients.manageAliases}
                      onClick={(): void => {
                        setAliasesFor(ingredient);
                        setAliasName('');
                      }}
                    >
                      <AdminIcon name="aliases" />
                    </button>
                    <button
                      type="button"
                      aria-label={text.dashboard.rename}
                      title={text.dashboard.rename}
                      onClick={(): void => openEdit(ingredient)}
                    >
                      <AdminIcon name="edit" />
                    </button>
                    <button
                      type="button"
                      aria-label={text.dashboard.delete}
                      title={
                        ingredient.usageCount > 0
                          ? text.tenantIngredients.cannotDelete
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
      {showForm ? (
        <IngredientModal
          text={text}
          form={form}
          isEditing={editing !== null}
          onSubmit={save}
          onChangeName={(event: ChangeEvent<HTMLInputElement>): void =>
            setForm({ ...form, canonicalName: event.currentTarget.value })
          }
          onAddAlias={(): void => setForm({ ...form, aliases: [...form.aliases, ''] })}
          onChangeAlias={updateAlias}
          onRemoveAlias={removeFormAlias}
          onClose={closeForm}
        />
      ) : null}
      {activeAliases === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="tenant-ingredient-aliases-title">
            <h2 id="tenant-ingredient-aliases-title">
              {text.tenantIngredients.manageAliases}: {activeAliases.canonicalName}
            </h2>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void addAlias(event)}>
              <label>
                {text.tenantIngredients.aliasName}
                <input
                  required
                  autoFocus
                  value={aliasName}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setAliasName(event.currentTarget.value)
                  }
                />
              </label>
              <button type="submit">{text.tenantIngredients.addAlias}</button>
            </form>
            <ul className="alias-list">
              {activeAliases.aliases.map((alias: IngredientAlias): JSX.Element => (
                <li key={alias.publicId}>
                  <span>{alias.alias}</span>
                  <button
                    type="button"
                    aria-label={text.dashboard.delete}
                    title={text.dashboard.delete}
                    onClick={(): void => void removeAlias(alias)}
                  >
                    <AdminIcon name="delete" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="button--secondary"
              onClick={(): void => setAliasesFor(null)}
            >
              {text.admin.cancel}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

function IngredientModal(properties: {
  text: Translation;
  form: IngredientForm;
  isEditing: boolean;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
  onChangeName: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddAlias: () => void;
  onChangeAlias: (index: number, value: string) => void;
  onRemoveAlias: (index: number) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-backdrop">
      <section className="modal" aria-labelledby="tenant-ingredient-title">
        <h2 id="tenant-ingredient-title">
          {properties.isEditing
            ? properties.text.tenantIngredients.edit
            : properties.text.tenantIngredients.create}
        </h2>
        <form
          onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void properties.onSubmit(event)}
        >
          <label>
            {properties.text.tenantIngredients.name}
            <input
              required
              autoFocus
              value={properties.form.canonicalName}
              onChange={properties.onChangeName}
            />
          </label>
          {properties.isEditing ? null : (
            <fieldset>
              <legend>{properties.text.tenantIngredients.aliases}</legend>
              {properties.form.aliases.map((alias: string, index: number): JSX.Element => (
                <div className="ingredient-form__alias" key={index}>
                  <input
                    required
                    value={alias}
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      properties.onChangeAlias(index, event.currentTarget.value)
                    }
                  />
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => properties.onRemoveAlias(index)}
                  >
                    {properties.text.dashboard.delete}
                  </button>
                </div>
              ))}
              <button type="button" className="button--secondary" onClick={properties.onAddAlias}>
                {properties.text.tenantIngredients.addAlias}
              </button>
            </fieldset>
          )}
          <button type="submit">{properties.text.admin.save}</button>
          <button type="button" className="button--secondary" onClick={properties.onClose}>
            {properties.text.admin.cancel}
          </button>
        </form>
      </section>
    </div>
  );
}

async function loadIngredients(
  path: string,
  setIngredients: (ingredients: Ingredient[]) => void,
): Promise<void> {
  const response: Response = await fetch(path, { credentials: 'same-origin' });
  if (response.ok)
    setIngredients(((await response.json()) as { ingredients: Ingredient[] }).ingredients);
}
