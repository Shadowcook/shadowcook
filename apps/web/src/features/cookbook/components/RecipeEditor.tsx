import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { ApiRequestError, jsonRequest, request } from '../../../lib/api/client';
import type { Category, EditableRecipe } from '../model/types';
import AdminIcon from '../../../components/AdminIcon';
import RecipeCategorySelector from './RecipeCategorySelector';
import RecipeStepsEditor from './RecipeStepsEditor';
import type { RecipeStepsEditorHandle } from './RecipeStepsEditor';
import RecipeVariantsEditor from './RecipeVariantsEditor';
import RecipeShareDialog from './RecipeShareDialog';
import type { RecipeShareLink } from './RecipeShareDialog';
import RecipeRevisionHistory from './RecipeRevisionHistory';

interface RecipeEditorProperties {
  locale: Locale;
  tenantSlug: string;
  recipePublicId: string | null;
  categories: Category[];
  onChanged: () => Promise<unknown>;
  onCreated: (publicId: string) => void;
}

interface RecipeForm {
  title: string;
  summary: string;
  slug: string;
  categoryPublicIds: string[];
  visibilityOverride: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC' | null;
  discoverabilityOverride: 'DISCOVERABLE' | 'UNLISTED' | null;
  isFeatured: boolean;
}
const emptyForm: RecipeForm = {
  title: '',
  summary: '',
  slug: '',
  categoryPublicIds: [],
  visibilityOverride: null,
  discoverabilityOverride: null,
  isFeatured: false,
};

export default function RecipeEditor(properties: RecipeEditorProperties): JSX.Element {
  const text: Translation = translations[properties.locale];
  const [form, setForm] = useState<RecipeForm>(emptyForm);
  const [recipe, setRecipe] = useState<EditableRecipe | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(properties.recipePublicId !== null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [tab, setTab] = useState<'recipe' | 'steps' | 'variants' | 'revisions'>('recipe');
  const [shareLinks, setShareLinks] = useState<RecipeShareLink[]>([]);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState<boolean>(false);
  const stepsEditor = useRef<RecipeStepsEditorHandle | null>(null);

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
      if (loaded.hasPublishedRevision && loaded.canChangeVisibility)
        await loadShareLinks(loaded.publicId);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadShareLinks(recipePublicId: string): Promise<void> {
    const response: { shareLinks: RecipeShareLink[] } = await request<{
      shareLinks: RecipeShareLink[];
    }>(
      `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipePublicId}/share-links`,
    );
    setShareLinks(response.shareLinks);
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
  async function saveRecipeDraft(): Promise<void> {
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

  async function saveCurrentDraft(): Promise<void> {
    if (tab === 'steps') {
      setIsSaving(true);
      try {
        await stepsEditor.current?.saveDraft();
      } finally {
        setIsSaving(false);
      }
      return;
    }
    await saveRecipeDraft();
  }

  async function markDraftChanged(): Promise<void> {
    setRecipe((current: EditableRecipe | null): EditableRecipe | null =>
      current === null ? null : { ...current, isDraft: true },
    );
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
      if (published.canChangeVisibility) await loadShareLinks(published.publicId);
      setMessage(text.recipeEditor.published);
      await properties.onChanged();
    } catch (error: unknown) {
      setMessage(editorError(error, text));
    } finally {
      setIsSaving(false);
    }
  }
  async function createShareLink(
    name: string | null,
    expiresAt: string | null,
  ): Promise<string | null> {
    if (recipe === null || !recipe.hasPublishedRevision) return null;
    setIsSaving(true);
    try {
      const link: { path: string } = await request<{ path: string }>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipe.publicId}/share-links`,
        jsonRequest({ name, expiresAt }),
      );
      await loadShareLinks(recipe.publicId);
      return link.path;
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
      return null;
    } finally {
      setIsSaving(false);
    }
  }
  async function copyShareLink(path: string): Promise<void> {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setMessage(text.recipeEditor.shareCreated);
  }
  async function revokeShareLink(link: RecipeShareLink): Promise<void> {
    if (recipe === null) return;
    setIsSaving(true);
    try {
      await request<void>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipe.publicId}/share-links/${link.id}`,
        { method: 'DELETE' },
      );
      setShareLinks((current: RecipeShareLink[]): RecipeShareLink[] =>
        current.filter((candidate: RecipeShareLink): boolean => candidate.id !== link.id),
      );
      setMessage(text.recipeEditor.shareRevoked);
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
      <p className="eyebrow">
        {recipe === null ? text.recipeEditor.create : text.recipeEditor.title}
      </p>
      <h1>{recipe?.title ?? text.recipeEditor.title}</h1>
      {recipe !== null && recipe.publishedVersion !== null ? (
        <p className="hint">
          {text.recipeEditor.version}: {recipe.publishedVersion}
        </p>
      ) : null}
      {recipe === null ? null : (
        <nav className="recipe-editor__tabs">
          <button
            type="button"
            className={tab === 'recipe' ? '' : 'button--secondary'}
            onClick={(): void => setTab('recipe')}
          >
            {text.recipeEditor.recipe}
          </button>
          <button
            type="button"
            className={tab === 'steps' ? '' : 'button--secondary'}
            onClick={(): void => setTab('steps')}
          >
            {text.recipeEditor.steps}
          </button>
          <button
            type="button"
            className={tab === 'variants' ? '' : 'button--secondary'}
            onClick={(): void => setTab('variants')}
          >
            {text.recipeEditor.variants}
          </button>
          {recipe.hasPublishedRevision ? (
            <button
              type="button"
              className={tab === 'revisions' ? '' : 'button--secondary'}
              onClick={(): void => setTab('revisions')}
            >
              {text.recipeEditor.revisions}
            </button>
          ) : null}
        </nav>
      )}
      {tab === 'recipe' ? (
        <form
          onSubmit={(event: SubmitEvent<HTMLFormElement>): void => {
            event.preventDefault();
            void saveRecipeDraft();
          }}
        >
          <label>
            {text.recipeEditor.recipeTitle}
            <input value={form.title} onChange={changeTitle} maxLength={240} required autoFocus />
          </label>
          <label className="recipe-editor__check" title={text.recipeEditor.featuredHint}>
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setForm({ ...form, isFeatured: event.currentTarget.checked })
              }
            />
            {text.recipeEditor.featured}
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
              value={form.visibilityOverride ?? 'INHERIT'}
              disabled={recipe !== null && !recipe.canChangeVisibility}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setForm({
                  ...form,
                  visibilityOverride:
                    event.currentTarget.value === 'INHERIT'
                      ? null
                      : (event.currentTarget.value as 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC'),
                })
              }
            >
              <option value="INHERIT">{text.recipeEditor.inheritVisibility}</option>
              <option value="PRIVATE">{text.recipeEditor.private}</option>
              <option value="MEMBERS_ONLY">{text.recipeEditor.membersOnly}</option>
              <option value="PUBLIC">{text.recipeEditor.public}</option>
            </select>
          </label>
          <label>
            {text.recipeEditor.discoverability}
            <select
              value={form.discoverabilityOverride ?? 'INHERIT'}
              disabled={recipe !== null && !recipe.canChangeVisibility}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setForm({
                  ...form,
                  discoverabilityOverride:
                    event.currentTarget.value === 'INHERIT'
                      ? null
                      : (event.currentTarget.value as 'DISCOVERABLE' | 'UNLISTED'),
                })
              }
            >
              <option value="INHERIT">{text.recipeEditor.inheritDiscoverability}</option>
              <option value="DISCOVERABLE">{text.recipeEditor.discoverable}</option>
              <option value="UNLISTED">{text.recipeEditor.unlisted}</option>
            </select>
          </label>
          {message.length > 0 ? (
            <p className="message" role="status">
              {message}
            </p>
          ) : null}
        </form>
      ) : null}
      {recipe === null || tab !== 'steps' ? null : (
        <RecipeStepsEditor
          ref={stepsEditor}
          tenantSlug={properties.tenantSlug}
          recipePublicId={recipe.publicId}
          text={text}
          onDraftChanged={markDraftChanged}
        />
      )}
      {recipe === null || tab !== 'variants' ? null : (
        <RecipeVariantsEditor
          tenantSlug={properties.tenantSlug}
          recipePublicId={recipe.publicId}
          text={text}
          onDraftChanged={markDraftChanged}
        />
      )}
      {recipe === null || tab !== 'revisions' ? null : (
        <RecipeRevisionHistory
          tenantSlug={properties.tenantSlug}
          recipePublicId={recipe.publicId}
          text={text}
        />
      )}
      {recipe === null ? null : (
        <>
          <div className="recipe-editor__actions">
            <button type="button" disabled={isSaving} onClick={(): void => void saveCurrentDraft()}>
              {isSaving ? text.recipeEditor.saving : text.recipeEditor.saveDraft}
            </button>
            <button
              type="button"
              disabled={isSaving || !recipe.isDraft || form.categoryPublicIds.length === 0}
              onClick={(): void => void publish()}
            >
              {isSaving ? text.recipeEditor.publishing : text.recipeEditor.publish}
            </button>
            {recipe.hasPublishedRevision && recipe.canChangeVisibility ? (
              <button
                type="button"
                className="button--secondary"
                disabled={isSaving}
                onClick={(): void => setIsShareDialogOpen(true)}
                aria-label={text.recipeEditor.share}
                title={text.recipeEditor.share}
              >
                <AdminIcon name="share" />
              </button>
            ) : null}
          </div>
          {recipe.isDraft && form.categoryPublicIds.length === 0 ? (
            <p className="hint">{text.recipeEditor.publishNeedsCategory}</p>
          ) : null}
          {isShareDialogOpen ? (
            <RecipeShareDialog
              text={text}
              links={shareLinks}
              isSaving={isSaving}
              onClose={(): void => setIsShareDialogOpen(false)}
              onCreate={createShareLink}
              onCopy={copyShareLink}
              onRevoke={revokeShareLink}
            />
          ) : null}
        </>
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
    visibilityOverride: recipe.visibilityOverride,
    discoverabilityOverride: recipe.discoverabilityOverride,
    isFeatured: recipe.isFeatured,
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
