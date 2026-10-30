import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';
import RecipeMetadataEditor from './RecipeMetadataEditor';
import {
  emptyRecipeMetadata,
  type RecipeContentMetadata,
  type RecipeDiet,
} from '../model/recipe-metadata';
import MessageDialog from '../../../components/MessageDialog';
import { request } from '../../../lib/api/client';
import { recipeRequestError } from '../model/recipe-request-error';

export interface DraftVariant {
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
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
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  name: string;
  slug: string;
}

const emptyForm: VariantForm = { name: '', slug: '', metadata: emptyRecipeMetadata(), diet: null };

export default function RecipeVariantsEditor(properties: Properties): JSX.Element {
  const base: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft/variants`;
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [editing, setEditing] = useState<DraftVariant | null>(null);
  const [form, setForm] = useState<VariantForm | null>(null);
  const [slugEdited, setSlugEdited] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function load(): Promise<void> {
    try {
      const response: { variants: DraftVariant[] } = await request<{ variants: DraftVariant[] }>(
        base,
      );
      setVariants(response.variants);
    } catch (error: unknown) {
      setErrorMessage(recipeRequestError(error, properties.text));
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
    const defaultVariant: DraftVariant | undefined = variants.find(
      (variant: DraftVariant): boolean => variant.isDefault,
    );
    setForm({
      ...emptyForm,
      metadata: { ...(defaultVariant?.metadata ?? emptyRecipeMetadata()) },
      diet: defaultVariant?.diet ?? null,
    });
  }

  function openEditDialog(variant: DraftVariant): void {
    setEditing(variant);
    setSlugEdited(false);
    setForm({
      name: variant.name,
      slug: variant.slug,
      metadata: variant.metadata,
      diet: variant.diet,
    });
  }

  function closeDialog(): void {
    setEditing(null);
    setForm(null);
  }

  function changeName(event: ChangeEvent<HTMLInputElement>): void {
    if (form === null) return;
    const name: string = event.currentTarget.value;
    setForm({ ...form, name, slug: slugEdited ? form.slug : slugFromName(name) });
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

    if (
      form.metadata.totalMinutes !== null &&
      form.metadata.activeMinutes !== null &&
      form.metadata.activeMinutes > form.metadata.totalMinutes
    ) {
      setErrorMessage(properties.text.recipeMetadata.durationExceeded);
      return;
    }
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
    } catch (error: unknown) {
      setErrorMessage(recipeRequestError(error, properties.text));
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
    } catch (error: unknown) {
      setErrorMessage(recipeRequestError(error, properties.text));
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
      setErrorMessage(recipeRequestError(error, properties.text));
    }
  }

  const slugConflict: boolean = form !== null && hasSlugConflict(form.slug);

  return (
    <section className="recipe-variants-editor">
      <div className="recipe-variants-editor__heading">
        <h2>{properties.text.recipeEditor.variants}</h2>
        <button
          type="button"
          disabled={variants.length === 0}
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
            <RecipeMetadataEditor
              metadata={form.metadata}
              diet={form.diet}
              text={properties.text}
              onChange={(metadata: RecipeContentMetadata, diet: RecipeDiet | null): void =>
                setForm({ ...form, metadata, diet })
              }
            />
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

      {errorMessage.length > 0 ? (
        <MessageDialog
          kind="error"
          text={properties.text.dialog}
          message={errorMessage}
          onClose={(): void => setErrorMessage('')}
        />
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
