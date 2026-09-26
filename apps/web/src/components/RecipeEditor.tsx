import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from './api-client';
import type { Category, EditableRecipe } from './cookbook-types';
import RecipeCategorySelector from './RecipeCategorySelector';
import RecipeStepsEditor from './RecipeStepsEditor';

interface RecipeEditorProperties {
  locale: Locale;
  tenantSlug: string;
  recipePublicId: string | null;
  categories: Category[];
  onClose: () => void;
  onChanged: () => Promise<unknown>;
  onCreated: (publicId: string) => void;
}

interface RecipeForm {
  title: string;
  summary: string;
  slug: string;
  categoryPublicIds: string[];
  visibility: 'PRIVATE' | 'PUBLIC';
}

const emptyForm: RecipeForm = {
  title: '',
  summary: '',
  slug: '',
  categoryPublicIds: [],
  visibility: 'PRIVATE',
};

export default function RecipeEditor(properties: RecipeEditorProperties): JSX.Element {
  const text: Translation = translations[properties.locale];
  const [form, setForm] = useState<RecipeForm>(emptyForm);
  const [recipe, setRecipe] = useState<EditableRecipe | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(properties.recipePublicId !== null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect((): void => {
    if (properties.recipePublicId === null) return;
    void loadRecipe();
  }, [properties.recipePublicId, properties.tenantSlug]);

  async function loadRecipe(): Promise<void> {
    if (properties.recipePublicId === null) return;
    setIsLoading(true);
    try {
      const loaded: EditableRecipe = await request<EditableRecipe>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft`,
      );
      setRecipe(loaded);
      setForm(formFromRecipe(loaded));
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsLoading(false);
    }
  }

  function changeTitle(event: ChangeEvent<HTMLInputElement>): void {
    const title: string = event.currentTarget.value;
    setForm((current: RecipeForm): RecipeForm => ({
      ...current,
      title,
      slug: recipe === null ? slugFromTitle(title) : current.slug,
    }));
  }
  function toggleCategory(categoryId: string): void {
    setForm((current: RecipeForm): RecipeForm => ({
      ...current,
      categoryPublicIds: current.categoryPublicIds.includes(categoryId)
        ? current.categoryPublicIds.filter((id: string): boolean => id !== categoryId)
        : [...current.categoryPublicIds, categoryId],
    }));
  }
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    setIsSaving(true);
    try {
      const saved: EditableRecipe =
        recipe === null
          ? await request<EditableRecipe>(
              `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes`,
              jsonRequest(form),
            )
          : await request<EditableRecipe>(
              `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
              },
            );
      setRecipe(saved);
      setForm(formFromRecipe(saved));
      if (recipe === null) properties.onCreated(saved.publicId);
      setMessage(text.recipeEditor.saved);
      await properties.onChanged();
    } catch (error: unknown) {
      setMessage(editorError(error, text));
    } finally {
      setIsSaving(false);
    }
  }
  async function publish(): Promise<void> {
    if (recipe === null) return;
    setMessage('');
    setIsSaving(true);
    try {
      const published: EditableRecipe = await request<EditableRecipe>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipe.publicId}/publish`,
        { method: 'POST' },
      );
      setRecipe(published);
      setForm(formFromRecipe(published));
      setMessage(text.recipeEditor.published);
      await properties.onChanged();
    } catch (error: unknown) {
      setMessage(editorError(error, text));
    } finally {
      setIsSaving(false);
    }
  }
  async function createShareLink(): Promise<void> {
    if (recipe === null || !recipe.hasPublishedRevision) return;
    setIsSaving(true);
    try {
      const link: { path: string } = await request<{ path: string }>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipe.publicId}/share-links`,
        { method: 'POST' },
      );
      await navigator.clipboard.writeText(`${window.location.origin}${link.path}`);
      setMessage(text.recipeEditor.shareCreated);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsSaving(false);
    }
  }
  if (isLoading)
    return (
      <section className="recipe-editor">
        <p className="empty-state">{text.loading}</p>
      </section>
    );
  return (
    <section className="recipe-editor">
      <button type="button" className="button--secondary" onClick={properties.onClose}>
        {text.recipeEditor.back}
      </button>
      <p className="eyebrow">
        {recipe === null ? text.recipeEditor.create : text.recipeEditor.title}
      </p>
      <h1>{recipe?.title ?? text.recipeEditor.title}</h1>
      {recipe !== null && recipe.publishedVersion !== null ? (
        <p className="hint">
          {text.recipeEditor.version}: {recipe.publishedVersion}
        </p>
      ) : null}
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}>
        <label>
          {text.recipeEditor.recipeTitle}
          <input value={form.title} onChange={changeTitle} maxLength={240} required autoFocus />
        </label>
        <label>
          {text.recipeEditor.summary}
          <textarea
            value={form.summary}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setForm({ ...form, summary: event.currentTarget.value })
            }
            maxLength={2000}
          />
        </label>
        <label>
          {text.recipeEditor.slug}
          <input
            value={form.slug}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setForm({ ...form, slug: event.currentTarget.value.toLowerCase() })
            }
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </label>
        <fieldset>
          <legend>{text.recipeEditor.categories}</legend>
          <RecipeCategorySelector
            categories={properties.categories}
            selectedCategoryIds={form.categoryPublicIds}
            text={text}
            onToggleCategory={toggleCategory}
          />
        </fieldset>
        <label>
          {text.recipeEditor.visibility}
          <select
            value={form.visibility}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              setForm({ ...form, visibility: event.currentTarget.value as 'PRIVATE' | 'PUBLIC' })
            }
          >
            <option value="PRIVATE">{text.recipeEditor.private}</option>
            <option value="PUBLIC">{text.recipeEditor.public}</option>
          </select>
        </label>
        {message.length > 0 ? (
          <p className="message" role="status">
            {message}
          </p>
        ) : null}
        <div className="recipe-editor__actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? text.recipeEditor.saving : text.recipeEditor.saveDraft}
          </button>
          {recipe !== null && recipe.isDraft ? (
            <button
              type="button"
              disabled={isSaving || form.categoryPublicIds.length === 0}
              onClick={(): void => void publish()}
            >
              {isSaving ? text.recipeEditor.publishing : text.recipeEditor.publish}
            </button>
          ) : null}
          {recipe?.hasPublishedRevision ? (
            <button
              type="button"
              className="button--secondary"
              disabled={isSaving}
              onClick={(): void => void createShareLink()}
            >
              {text.recipeEditor.share}
            </button>
          ) : null}
        </div>
        {recipe !== null && recipe.isDraft && form.categoryPublicIds.length === 0 ? (
          <p className="hint">{text.recipeEditor.publishNeedsCategory}</p>
        ) : null}
      </form>
      {recipe === null ? null : (
        <RecipeStepsEditor
          tenantSlug={properties.tenantSlug}
          recipePublicId={recipe.publicId}
          text={text}
        />
      )}
    </section>
  );
}
function formFromRecipe(recipe: EditableRecipe): RecipeForm {
  return {
    title: recipe.title,
    summary: recipe.summary ?? '',
    slug: recipe.slug,
    categoryPublicIds: recipe.categoryPublicIds,
    visibility: recipe.visibility,
  };
}
function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function editorError(error: unknown, text: Translation): string {
  return error instanceof ApiRequestError && error.code === 'PUBLISH_CATEGORY_REQUIRED'
    ? text.recipeEditor.publishNeedsCategory
    : text.errors.requestFailed;
}
