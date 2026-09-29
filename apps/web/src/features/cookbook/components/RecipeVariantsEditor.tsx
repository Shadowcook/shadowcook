import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';
import { ApiRequestError, request } from '../../../lib/api/client';

export interface DraftVariant {
  variantKey: string;
  name: string;
  slug: string;
  isDefault: boolean;
  isVisible: boolean;
  overrides: Array<{ stepId: string; state: 'INCLUDE' }>;
}

interface Properties {
  tenantSlug: string;
  recipePublicId: string;
  text: Translation;
  onDraftChanged: () => Promise<void>;
}

interface VariantForm {
  name: string;
  slug: string;
}

const emptyForm: VariantForm = { name: '', slug: '' };

export default function RecipeVariantsEditor(properties: Properties): JSX.Element {
  const base: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft/variants`;
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [editing, setEditing] = useState<DraftVariant | null>(null);
  const [form, setForm] = useState<VariantForm | null>(null);
  const [slugEdited, setSlugEdited] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  async function load(): Promise<void> {
    try {
      const response: { variants: DraftVariant[] } = await request<{ variants: DraftVariant[] }>(
        base,
      );
      setVariants(response.variants);
    } catch {
      setMessage(properties.text.errors.requestFailed);
    }
  }

  useEffect((): void => {
    void load();
  }, [base]);

  function hasSlugConflict(slug: string): boolean {
    return variants.some(
      (variant: DraftVariant): boolean =>
        variant.slug === slug && variant.variantKey !== editing?.variantKey,
    );
  }

  function openCreateDialog(): void {
    setEditing(null);
    setSlugEdited(false);
    setForm(emptyForm);
  }

  function openEditDialog(variant: DraftVariant): void {
    setEditing(variant);
    setSlugEdited(false);
    setForm({ name: variant.name, slug: variant.slug });
  }

  function closeDialog(): void {
    setEditing(null);
    setForm(null);
  }

  function changeName(event: ChangeEvent<HTMLInputElement>): void {
    if (form === null) return;
    const name: string = event.currentTarget.value;
    setForm({ name, slug: slugEdited ? form.slug : slugFromName(name) });
  }

  function changeSlug(event: ChangeEvent<HTMLInputElement>): void {
    if (form === null) return;
    setSlugEdited(true);
    setForm({ ...form, slug: event.currentTarget.value.toLowerCase() });
  }

  async function saveVariant(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      form === null ||
      form.name.trim().length === 0 ||
      form.slug.length === 0 ||
      hasSlugConflict(form.slug)
    )
      return;

    try {
      if (editing === null) {
        await request<void>(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, isDefault: false, isVisible: true }),
        });
      } else if (!(await updateVariant({ ...editing, ...form }, false, false))) return;
      closeDialog();
      await load();
      await properties.onDraftChanged();
    } catch {
      setMessage(properties.text.errors.requestFailed);
    }
  }

  async function updateVariant(
    variant: DraftVariant,
    reload: boolean = true,
    notifyDraftChange: boolean = true,
  ): Promise<boolean> {
    try {
      await request<void>(`${base}/${variant.variantKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variant),
      });
      if (reload) await load();
      if (notifyDraftChange) await properties.onDraftChanged();
      return true;
    } catch {
      setMessage(properties.text.errors.requestFailed);
      return false;
    }
  }

  async function remove(variant: DraftVariant): Promise<void> {
    try {
      const defaultVariant: DraftVariant | undefined = variants.find(
        (item: DraftVariant): boolean => item.isDefault && item.variantKey !== variant.variantKey,
      );
      await request<void>(`${base}/${variant.variantKey}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacementDefaultVariantKey: defaultVariant?.variantKey }),
      });
      await load();
      await properties.onDraftChanged();
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiRequestError && error.code === 'RECIPE_VARIANT_HAS_STEPS'
          ? properties.text.recipeEditor.variantHasSteps
          : properties.text.errors.requestFailed,
      );
    }
  }

  const slugConflict: boolean = form !== null && hasSlugConflict(form.slug);

  return (
    <section className="recipe-variants-editor">
      <div className="recipe-variants-editor__heading">
        <h2>{properties.text.recipeEditor.variants}</h2>
        <button
          type="button"
          onClick={openCreateDialog}
          aria-label={properties.text.recipeEditor.addVariant}
          title={properties.text.recipeEditor.addVariant}
        >
          <AdminIcon name="add" />
        </button>
      </div>

      <div className="recipe-variants-editor__table-wrap">
        <table className="recipe-variants-table">
          <thead>
            <tr>
              <th>{properties.text.recipeEditor.variantName}</th>
              <th>{properties.text.recipeEditor.variantUrl}</th>
              <th>{properties.text.recipeEditor.variantDefault}</th>
              <th>{properties.text.recipeEditor.variantVisible}</th>
              <th>{properties.text.recipeEditor.variantActions}</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant: DraftVariant): JSX.Element => (
              <tr key={variant.variantKey}>
                <td>{variant.name}</td>
                <td>{variant.slug}</td>
                <td>{variant.isDefault ? properties.text.recipeEditor.variantDefault : ''}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={variant.isVisible}
                    disabled={variant.isDefault && variant.isVisible}
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      void updateVariant({ ...variant, isVisible: event.currentTarget.checked })
                    }
                    aria-label={properties.text.recipeEditor.variantVisible}
                  />
                </td>
                <td className="recipe-variants-table__actions">
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => openEditDialog(variant)}
                    aria-label={properties.text.recipeEditor.editVariant}
                    title={properties.text.recipeEditor.editVariant}
                  >
                    <AdminIcon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    disabled={variant.isDefault || !variant.isVisible}
                    onClick={(): void => void updateVariant({ ...variant, isDefault: true })}
                    aria-label={properties.text.recipeEditor.makeDefaultVariant}
                    title={properties.text.recipeEditor.makeDefaultVariant}
                  >
                    <AdminIcon name="default" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    disabled={variant.overrides.some(
                      (override: { stepId: string; state: 'INCLUDE' }): boolean =>
                        override.state === 'INCLUDE',
                    )}
                    onClick={(): void => void remove(variant)}
                    aria-label={properties.text.recipeEditor.deleteVariant}
                    title={properties.text.recipeEditor.deleteVariant}
                  >
                    <AdminIcon name="delete" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form === null ? null : (
        <div className="recipe-variant-dialog-backdrop">
          <form
            className="recipe-variant-dialog"
            onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void saveVariant(event)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-variant-dialog-title"
          >
            <h3 id="recipe-variant-dialog-title">
              {editing === null
                ? properties.text.recipeEditor.addVariant
                : properties.text.recipeEditor.editVariant}
            </h3>
            <label>
              {properties.text.recipeEditor.variantName}
              <input value={form.name} onChange={changeName} autoFocus required />
            </label>
            <label>
              {properties.text.recipeEditor.variantUrl}
              <input value={form.slug} onChange={changeSlug} required />
            </label>
            {slugConflict ? (
              <p className="message">{properties.text.recipeEditor.variantSlugConflict}</p>
            ) : null}
            <div className="recipe-variant-dialog__actions">
              <button type="button" className="button--secondary" onClick={closeDialog}>
                {properties.text.admin.cancel}
              </button>
              <button type="submit" disabled={slugConflict}>
                {properties.text.admin.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function slugFromName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
