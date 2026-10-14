import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { ApiRequestError, jsonRequest, request } from '../../../lib/api/client';
import type { Category, EditableRecipe } from '../model/types';
import AdminIcon from '../../../components/AdminIcon';
import MessageDialog from '../../../components/MessageDialog';
import RecipeCategorySelector from './RecipeCategorySelector';
import RecipeStepsEditor from './RecipeStepsEditor';
import RecipeVariantsEditor from './RecipeVariantsEditor';
import RecipeShareDialog from './RecipeShareDialog';
import type { RecipeShareLink } from './RecipeShareDialog';
import RecipeRevisionHistory from './RecipeRevisionHistory';
import RecipeDraftDiscardButton from './RecipeDraftDiscardButton';
import RecipeEditorActionBar from './RecipeEditorActionBar';
import RecipeEditorSaveButton from './RecipeEditorSaveButton';
import RecipeSlugField from './RecipeSlugField';
import { recipeCreationCategoryId } from '../model/recipe-creation';
import { recipeRequestError } from '../model/recipe-request-error';
import { useRecipeSlugAvailability } from '../model/use-recipe-slug-availability';
import type { RecipeSlugStatus } from '../model/use-recipe-slug-availability';

interface RecipeEditorProperties {
  locale: Locale;
  tenantSlug: string;
  recipePublicId: string | null;
  categories: Category[];
  initialCategoryId?: string | null;
  onChanged: () => Promise<unknown>;
  onCreated: (publicId: string) => void;
  onDiscarded: () => void;
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

interface RecipeDraftForm {
  title: string;
  summary: string;
  categoryPublicIds: string[];
}

interface RecipeMetadataForm {
  slug: string;
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
  isFeatured: true,
};

export default function RecipeEditor(properties: RecipeEditorProperties): JSX.Element {
  const text: Translation = translations[properties.locale];
  const [form, setForm] = useState<RecipeForm>((): RecipeForm => {
    const categoryId: string | null =
      properties.recipePublicId === null
        ? recipeCreationCategoryId(properties.categories, properties.initialCategoryId ?? null)
        : null;
    return { ...emptyForm, categoryPublicIds: categoryId === null ? [] : [categoryId] };
  });
  const [recipe, setRecipe] = useState<EditableRecipe | null>(null);
  const [message, setMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [conflictingSlug, setConflictingSlug] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(properties.recipePublicId !== null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSavingSteps, setIsSavingSteps] = useState<boolean>(false);
  const [stepsActionsContainer, setStepsActionsContainer] = useState<HTMLDivElement | null>(null);
  const draftFormId: string = useId();
  const isBusy: boolean = isSaving || isSavingSteps;
  const [tab, setTab] = useState<'recipe' | 'steps' | 'variants' | 'revisions'>('recipe');
  const [shareLinks, setShareLinks] = useState<RecipeShareLink[]>([]);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState<boolean>(false);
  const checkedSlugStatus: RecipeSlugStatus = useRecipeSlugAvailability(
    properties.tenantSlug,
    form.slug,
    recipe?.publicId ?? null,
    recipe?.slug ?? null,
  );
  const slugStatus: RecipeSlugStatus =
    conflictingSlug === form.slug ? 'conflict' : checkedSlugStatus;
  const slugBlocksSave: boolean =
    slugStatus === 'conflict' || slugStatus === 'invalid' || slugStatus === 'checking';

  function showError(error: unknown): void {
    setErrorMessage(recipeRequestError(error, text));
    if (error instanceof ApiRequestError && error.code === 'RECIPE_CONFLICT')
      setConflictingSlug(form.slug);
  }

  useEffect((): void => {
    if (properties.recipePublicId === null) return;
    void loadRecipe();
  }, [properties.recipePublicId, properties.tenantSlug]);

  async function loadRecipe(): Promise<boolean> {
    if (properties.recipePublicId === null) return false;
    setIsLoading(true);
    try {
      const loaded: EditableRecipe = await request<EditableRecipe>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft`,
      );
      setRecipe(loaded);
      setForm(formFromRecipe(loaded));
      if (loaded.hasPublishedRevision && loaded.canChangeVisibility)
        await loadShareLinks(loaded.publicId);
      return true;
    } catch (error: unknown) {
      showError(error);
      return false;
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
    if (isBusy) return;
    if (recipe === null && slugBlocksSave) return;
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
                body: JSON.stringify(recipeDraftForm(form)),
              },
            );
      setRecipe(saved);
      setForm(formFromRecipe(saved));
      if (recipe === null) properties.onCreated(saved.publicId);
      setMessage(text.recipeEditor.saved);
      await properties.onChanged();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRecipeMetadata(): Promise<void> {
    if (recipe === null || isBusy) return;
    if (form.slug.length === 0 || slugStatus === 'invalid') {
      setErrorMessage(text.recipeEditor.invalidSlug);
      return;
    }
    if (slugBlocksSave) return;
    setMessage('');
    setIsSaving(true);
    try {
      const saved: EditableRecipe = await request<EditableRecipe>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${recipe.publicId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recipeMetadataForm(form)),
        },
      );
      setRecipe(saved);
      setForm(formFromRecipe(saved));
      setMessage(text.recipeEditor.metadataSaved);
      await properties.onChanged();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function markDraftChanged(): Promise<void> {
    setRecipe((current: EditableRecipe | null): EditableRecipe | null =>
      current === null ? null : { ...current, isDraft: true },
    );
  }
  async function draftDiscarded(): Promise<void> {
    if (recipe === null) return;
    if (recipe.hasPublishedRevision) {
      const hasLoaded: boolean = await loadRecipe();
      if (hasLoaded) setMessage(text.recipeEditor.draftDiscarded);
    } else {
      properties.onDiscarded();
    }
    await properties.onChanged();
  }
  async function publish(): Promise<void> {
    if (recipe === null || isBusy) return;
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
      showError(error);
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
    } catch (error: unknown) {
      showError(error);
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
    } catch (error: unknown) {
      showError(error);
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
      <RecipeEditorActionBar>
        <div className="recipe-editor-action-bar__primary">
          {tab === 'recipe' ? (
            <RecipeEditorSaveButton
              form={draftFormId}
              disabled={isBusy || (recipe === null && slugBlocksSave)}
              label={isSaving ? text.recipeEditor.saving : text.recipeEditor.saveDraft}
            />
          ) : null}
          <div ref={setStepsActionsContainer} hidden={tab !== 'steps'} />
          {recipe === null ? null : (
            <button
              type="button"
              disabled={isBusy || !recipe.isDraft || form.categoryPublicIds.length === 0}
              aria-busy={isSaving}
              onClick={(): void => void publish()}
            >
              <span className="recipe-editor-action-bar__mobile-label">
                {text.recipeEditor.publish}
              </span>
              <span className="recipe-editor-action-bar__button-label">
                {isSaving ? text.recipeEditor.publishing : text.recipeEditor.publish}
              </span>
            </button>
          )}
        </div>
        {recipe === null ? null : (
          <div className="recipe-editor-action-bar__secondary">
            {recipe.isDraft ? (
              <RecipeDraftDiscardButton
                text={text}
                tenantSlug={properties.tenantSlug}
                recipe={recipe}
                compactOnMobile
                disabled={isBusy}
                onBusyChanged={setIsSaving}
                onDiscarded={draftDiscarded}
              />
            ) : null}
            {recipe.hasPublishedRevision && recipe.canChangeVisibility ? (
              <button
                type="button"
                className="button--secondary"
                disabled={isBusy}
                onClick={(): void => setIsShareDialogOpen(true)}
                aria-label={text.recipeEditor.share}
                title={text.recipeEditor.share}
              >
                <AdminIcon name="share" />
              </button>
            ) : null}
          </div>
        )}
      </RecipeEditorActionBar>
      {recipe !== null && recipe.isDraft && form.categoryPublicIds.length === 0 ? (
        <p className="hint">{text.recipeEditor.publishNeedsCategory}</p>
      ) : null}
      {tab === 'recipe' ? (
        <form
          id={draftFormId}
          onSubmit={(event: SubmitEvent<HTMLFormElement>): void => {
            event.preventDefault();
            void saveRecipeDraft();
          }}
        >
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
          <fieldset>
            <legend>{text.recipeEditor.categories}</legend>
            <RecipeCategorySelector
              categories={properties.categories}
              selectedCategoryIds={form.categoryPublicIds}
              text={text}
              onToggleCategory={toggleCategory}
            />
          </fieldset>
          <fieldset>
            <legend>{text.recipeEditor.metadata}</legend>
            <RecipeSlugField
              value={form.slug}
              status={slugStatus}
              text={text}
              onChange={(slug: string): void => {
                setConflictingSlug(null);
                setForm({ ...form, slug });
              }}
            />
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
              {text.recipeEditor.visibility}
              <select
                value={form.visibilityOverride ?? 'INHERIT'}
                disabled={recipe === null || !recipe.canChangeVisibility}
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
                disabled={recipe === null || !recipe.canChangeVisibility}
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
            {recipe === null ? null : (
              <button
                type="button"
                className="recipe-editor__save-button button--secondary"
                disabled={isBusy || slugBlocksSave}
                onClick={(): void => void saveRecipeMetadata()}
              >
                {isSaving ? text.recipeEditor.saving : text.recipeEditor.saveMetadata}
              </button>
            )}
          </fieldset>
        </form>
      ) : null}
      {recipe === null ? null : (
        <div hidden={tab !== 'steps'}>
          <RecipeStepsEditor
            tenantSlug={properties.tenantSlug}
            recipePublicId={recipe.publicId}
            text={text}
            onDraftChanged={markDraftChanged}
            actionsContainer={stepsActionsContainer}
            isBusy={isSaving}
            onBusyChanged={setIsSavingSteps}
          />
        </div>
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
      {recipe !== null && isShareDialogOpen ? (
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
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      {errorMessage.length > 0 ? (
        <MessageDialog
          kind="error"
          text={text.dialog}
          message={errorMessage}
          onClose={(): void => setErrorMessage('')}
        />
      ) : null}
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

function recipeDraftForm(form: RecipeForm): RecipeDraftForm {
  return {
    title: form.title,
    summary: form.summary,
    categoryPublicIds: form.categoryPublicIds,
  };
}

function recipeMetadataForm(form: RecipeForm): RecipeMetadataForm {
  return {
    slug: form.slug,
    visibilityOverride: form.visibilityOverride,
    discoverabilityOverride: form.discoverabilityOverride,
    isFeatured: form.isFeatured,
  };
}
function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
