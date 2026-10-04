import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../i18n';
import type { Locale, Translation } from '../../i18n';
import { ApiRequestError, jsonRequest, request } from '../../lib/api/client';
import {
  cacheBrowserSession,
  clearAdminAccessCache,
  clearBrowserSessionCache,
} from '../../lib/browser/session-cache';
import type { BrowserSessionState } from '../../lib/browser/session-cache';
import CookbookDashboard from './components/CookbookDashboard';
import CategoryEditor from './components/CategoryEditor';
import { cookbookPath, resolveCookbookLocation } from './model/routing';
import type { CookbookLocation } from './model/routing';
import type { CookbookResponse, Recipe, RecipeDetail } from './model/types';
import RecipeEditor from './components/RecipeEditor';
import DraftRecipeList from './components/DraftRecipeList';
import SharedRecipeView from './components/SharedRecipeView';
import TenantNavigation from './components/TenantNavigation';
import RecipeManagementList from './components/RecipeManagementList';
import LoginScreen from '../../components/LoginScreen';
import type { AuthenticationMethods } from '../../components/LoginScreen';
import PasswordChangeScreen from '../../components/PasswordChangeScreen';
import AccessDeniedScreen from '../../components/AccessDeniedScreen';
import ManagementPlaceholder from './components/ManagementPlaceholder';
import TenantUserManagement from './components/TenantUserManagement';
import TenantIngredientManagement from './components/TenantIngredientManagement';
import TenantUnitManagement from './components/TenantUnitManagement';
import RecipePolicySettings from './components/RecipePolicySettings';
import RecipeShareDialog from './components/RecipeShareDialog';
import ServiceAccountManagement from './components/ServiceAccountManagement';
import type { RecipeShareLink } from './components/RecipeShareDialog';
import AiContextDialog from './components/AiContextDialog';
import '../../styles/cookbook.css';

interface CookbookScreenProperties {
  locale: Locale;
  notifyWhenReady?: boolean;
}
interface SessionResponse {
  email: string;
  hasPassword: boolean;
  passwordChangeRequired: boolean;
}
interface LoginResponse {
  hasPassword: boolean;
  passwordChangeRequired: boolean;
}
type Screen = 'loading' | 'login' | 'change-password' | 'dashboard';

const loginPath: string = '/login';
const emptyCookbook: CookbookResponse = {
  tenant: null,
  categories: [],
  recipes: [],
  canManageCategories: false,
  canManageRecipes: false,
  canManageUsers: false,
  canManageIngredients: false,
  canManageUnits: false,
  canManageServiceAccounts: false,
  canCreateAiContexts: false,
};

export default function CookbookScreen({
  locale,
  notifyWhenReady = false,
}: CookbookScreenProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [screen, setScreen] = useState<Screen>('loading');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [emailCode, setEmailCode] = useState<string>('');
  const [methods, setMethods] = useState<AuthenticationMethods>({
    password: true,
    emailCode: true,
  });
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [repeatPassword, setRepeatPassword] = useState<string>('');
  const [hasPassword, setHasPassword] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [cookbook, setCookbook] = useState<CookbookResponse>(emptyCookbook);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(null);
  const [isRecipeLoading, setIsRecipeLoading] = useState<boolean>(false);
  const [recipeError, setRecipeError] = useState<string>('');
  const [isCategoryEditor, setIsCategoryEditor] = useState<boolean>(false);
  const [editorPath, setEditorPath] = useState<'manage' | 'new' | 'drafts' | string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(sharedRecipeToken());
  const [isDetailShareDialogOpen, setIsDetailShareDialogOpen] = useState<boolean>(false);
  const [detailShareLinks, setDetailShareLinks] = useState<RecipeShareLink[]>([]);
  const [aiContextTarget, setAiContextTarget] = useState<{
    type: 'TENANT' | 'RECIPE' | 'CATEGORY';
    publicId: string;
    name: string;
  } | null>(null);

  useEffect((): void => {
    setIsCategoryEditor(categoryEditorPath());
    setEditorPath(recipeEditorPath());
    setShareToken(sharedRecipeToken());
    void restoreSession();
    void request<AuthenticationMethods>('/auth/authentication-methods')
      .then(setMethods)
      .catch((): void => undefined);
  }, []);
  useEffect((): (() => void) => {
    function restoreLocation(): void {
      setIsCategoryEditor(categoryEditorPath());
      setEditorPath(recipeEditorPath());
      setShareToken(sharedRecipeToken());
      void applyBrowserLocation(cookbook);
    }
    window.addEventListener('popstate', restoreLocation);
    return (): void => window.removeEventListener('popstate', restoreLocation);
  }, [cookbook, locale]);
  useEffect((): void => {
    const shell: HTMLElement | null = document.querySelector('.application-shell');
    shell?.classList.toggle('application-shell--admin', isCategoryEditor || editorPath !== null);
  }, [editorPath, isCategoryEditor]);
  useEffect((): void => {
    if (!notifyWhenReady || screen === 'loading') return;
    window.dispatchEvent(new CustomEvent('shadowcook:cookbook-ready'));
  }, [notifyWhenReady, screen]);

  async function restoreSession(): Promise<void> {
    try {
      const response: SessionResponse = await request<SessionResponse>('/auth/session');
      const session: BrowserSessionState = {
        authenticated: true,
        email: response.email,
        hasPassword: response.hasPassword,
        passwordChangeRequired: response.passwordChangeRequired,
      };
      cacheBrowserSession(session);
      await restoreCachedSession(session);
    } catch (error: unknown) {
      const session: BrowserSessionState = { authenticated: false };
      if (error instanceof ApiRequestError && error.code === 'AUTHENTICATION_REQUIRED')
        clearBrowserSessionCache();
      await restoreCachedSession(session);
    }
  }

  async function restoreCachedSession(session: BrowserSessionState): Promise<void> {
    if (sharedRecipeToken() !== null) {
      setScreen('dashboard');
      return;
    }
    if (!session.authenticated) {
      if (isLoginPath()) {
        setScreen('login');
        return;
      }
      const loaded: CookbookResponse = await loadCookbook();
      await applyBrowserLocation(loaded);
      setScreen('dashboard');
      return;
    }
    setEmail(session.email);
    setHasPassword(session.hasPassword);
    if (session.passwordChangeRequired) {
      setScreen('change-password');
      return;
    }
    if (isLoginPath()) {
      window.location.replace(postLoginPath());
      return;
    }
    const loaded: CookbookResponse = await loadCookbook();
    await applyBrowserLocation(loaded);
    setScreen('dashboard');
  }

  async function completeLogin(response: LoginResponse): Promise<void> {
    clearAdminAccessCache();
    cacheBrowserSession({
      authenticated: true,
      email,
      hasPassword: response.hasPassword,
      passwordChangeRequired: response.passwordChangeRequired,
    });
    if (response.passwordChangeRequired) {
      setHasPassword(response.hasPassword);
      setScreen('change-password');
      return;
    }
    window.location.replace(postLoginPath());
  }
  async function login(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    setIsSubmitting(true);
    try {
      await completeLogin(
        await request<LoginResponse>('/auth/login', jsonRequest({ email, password })),
      );
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  }
  async function requestCode(): Promise<void> {
    setMessage('');
    setIsSubmitting(true);
    try {
      await request<void>('/auth/email-code/request', jsonRequest({ email }));
      setMessage(text.login.codeSent);
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  }
  async function verifyCode(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code: string = emailCode;
    setEmailCode('');
    setMessage('');
    setIsSubmitting(true);
    try {
      await completeLogin(
        await request<LoginResponse>('/auth/email-code/verify', jsonRequest({ email, code })),
      );
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  }
  async function requestPasswordReset(): Promise<void> {
    setIsSubmitting(true);
    setMessage('');
    try {
      await request<void>('/auth/password-reset/request', jsonRequest({ email }));
      setMessage(text.login.passwordResetRequested);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsSubmitting(false);
    }
  }
  async function changePassword(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    if (newPassword !== repeatPassword) {
      setMessage(text.passwordChange.passwordMismatch);
      return;
    }
    setIsSubmitting(true);
    try {
      await request<void>('/auth/change-password', jsonRequest({ currentPassword, newPassword }));
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setHasPassword(true);
      cacheBrowserSession({
        authenticated: true,
        email,
        hasPassword: true,
        passwordChangeRequired: false,
      });
      await completeLogin({ hasPassword: true, passwordChangeRequired: false });
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  }
  async function openRecipe(publicId: string): Promise<void> {
    setRecipeError('');
    setIsRecipeLoading(true);
    try {
      const recipe: RecipeDetail = await request<RecipeDetail>(`/cookbook/recipes/${publicId}`);
      setSelectedRecipe(recipe);
      const overviewRecipe: Recipe | undefined = cookbook.recipes.find(
        (candidate: Recipe): boolean => candidate.public_id === publicId,
      );
      const slug: string | null = tenantSlugFromPath();
      if (overviewRecipe !== undefined && slug !== null)
        window.history.pushState(
          null,
          '',
          cookbookPath(
            slug,
            cookbook.categories,
            selectedCategoryId,
            overviewRecipe,
            recipe.selectedVariant === recipe.variants.find((variant) => variant.is_default)?.slug
              ? null
              : recipe.selectedVariant,
          ),
        );
    } catch (_error: unknown) {
      setRecipeError(text.dashboard.recipeLoadFailed);
    } finally {
      setIsRecipeLoading(false);
    }
  }
  async function selectRecipeVariant(slug: string): Promise<void> {
    if (selectedRecipe === null) return;
    try {
      const recipe: RecipeDetail = await request<RecipeDetail>(
        `/cookbook/recipes/${selectedRecipe.public_id}?variant=${encodeURIComponent(slug)}`,
      );
      setSelectedRecipe(recipe);
      const overviewRecipe = cookbook.recipes.find(
        (candidate: Recipe): boolean => candidate.public_id === selectedRecipe.public_id,
      );
      const tenantSlug = tenantSlugFromPath();
      if (overviewRecipe !== undefined && tenantSlug !== null)
        window.history.pushState(
          null,
          '',
          cookbookPath(
            tenantSlug,
            cookbook.categories,
            selectedCategoryId,
            overviewRecipe,
            recipe.selectedVariant === recipe.variants.find((variant) => variant.is_default)?.slug
              ? null
              : recipe.selectedVariant,
          ),
        );
    } catch (_error: unknown) {
      setRecipeError(text.dashboard.recipeLoadFailed);
    }
  }
  function selectCategory(categoryId: string | null): void {
    setIsCategoryEditor(false);
    setSelectedRecipe(null);
    setSelectedCategoryId(categoryId);
    setRecipeError('');
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null)
      window.history.pushState(null, '', cookbookPath(slug, cookbook.categories, categoryId, null));
  }
  function closeRecipe(): void {
    selectCategory(selectedCategoryId);
  }
  function editSelectedRecipe(): void {
    if (selectedRecipe === null) return;
    openRecipeEditor(selectedRecipe.public_id);
  }
  async function loadSelectedRecipeShareLinks(): Promise<void> {
    if (selectedRecipe === null) return;
    const tenantSlug: string | null = tenantSlugFromPath();
    if (tenantSlug === null) return;
    const response: { shareLinks: RecipeShareLink[] } = await request<{
      shareLinks: RecipeShareLink[];
    }>(
      `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes/${selectedRecipe.public_id}/share-links`,
    );
    setDetailShareLinks(response.shareLinks);
  }
  function openSelectedRecipeShareDialog(): void {
    void loadSelectedRecipeShareLinks()
      .then((): void => setIsDetailShareDialogOpen(true))
      .catch((): void => setRecipeError(text.errors.requestFailed));
  }
  function openSelectedRecipeAiContext(): void {
    if (selectedRecipe === null) return;
    setAiContextTarget({
      type: 'RECIPE',
      publicId: selectedRecipe.public_id,
      name: selectedRecipe.title,
    });
  }
  function openCategoryAiContext(publicId: string): void {
    const category = cookbook.categories.find(
      (candidate): boolean => candidate.public_id === publicId,
    );
    if (category === undefined) return;
    setAiContextTarget({ type: 'CATEGORY', publicId, name: category.name });
  }
  function openCookbookAiContext(): void {
    const cookbookName: string = cookbook.tenant?.display_name ?? text.dashboard.cookbook;
    setAiContextTarget({ type: 'TENANT', publicId: 'tenant', name: cookbookName });
  }
  async function createSelectedRecipeShareLink(
    name: string | null,
    expiresAt: string | null,
  ): Promise<string | null> {
    if (selectedRecipe === null) return null;
    const tenantSlug: string | null = tenantSlugFromPath();
    if (tenantSlug === null) return null;
    try {
      const link: { path: string } = await request<{ path: string }>(
        `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes/${selectedRecipe.public_id}/share-links`,
        jsonRequest({ name, expiresAt }),
      );
      await loadSelectedRecipeShareLinks();
      return link.path;
    } catch (_error: unknown) {
      setRecipeError(text.errors.requestFailed);
      return null;
    }
  }
  async function copySelectedRecipeShareLink(path: string): Promise<void> {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
  }
  async function revokeSelectedRecipeShareLink(link: RecipeShareLink): Promise<void> {
    if (selectedRecipe === null) return;
    const tenantSlug: string | null = tenantSlugFromPath();
    if (tenantSlug === null) return;
    await request<void>(
      `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes/${selectedRecipe.public_id}/share-links/${link.id}`,
      { method: 'DELETE' },
    );
    await loadSelectedRecipeShareLinks();
  }
  function openCategoryEditor(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug === null) return;
    window.history.pushState(null, '', `/${slug}/categories`);
    setSelectedRecipe(null);
    setEditorPath(null);
    setIsCategoryEditor(true);
  }
  function openRecipeEditor(recipePublicId: string | null): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug === null) return;
    window.history.pushState(
      null,
      '',
      recipePublicId === null ? `/${slug}/recipes/new` : `/${slug}/recipes/${recipePublicId}/edit`,
    );
    setIsCategoryEditor(false);
    setEditorPath(recipePublicId === null ? 'new' : recipePublicId);
  }
  function openDrafts(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug === null) return;
    window.history.pushState(null, '', `/${slug}/drafts`);
    setIsCategoryEditor(false);
    setEditorPath('drafts');
  }
  function openRecipes(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/recipes`);
    setIsCategoryEditor(false);
    setEditorPath('manage-recipes');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function openUsers(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/users`);
    setIsCategoryEditor(false);
    setEditorPath('manage-users');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function openIngredients(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/ingredients`);
    setIsCategoryEditor(false);
    setEditorPath('manage-ingredients');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function openUnits(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/units`);
    setIsCategoryEditor(false);
    setEditorPath('manage-units');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function openRecipePolicy(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/recipe-policy`);
    setIsCategoryEditor(false);
    setEditorPath('manage-recipe-policy');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function openServiceAccounts(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}/manage/service-accounts`);
    setIsCategoryEditor(false);
    setEditorPath('manage-service-accounts');
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
  }
  function closeTenantManagement(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}`);
    setIsCategoryEditor(false);
    setEditorPath(null);
    setSelectedCategoryId(null);
    setSelectedRecipe(null);
    void loadCookbook();
  }
  async function loadCookbook(): Promise<CookbookResponse> {
    const slug: string | null = tenantSlugFromPath();
    if (slug === null) {
      setCookbook(emptyCookbook);
      return emptyCookbook;
    }
    try {
      const response: CookbookResponse = await request<CookbookResponse>(
        `/cookbook?tenantSlug=${encodeURIComponent(slug)}`,
      );
      setCookbook(response);
      return response;
    } catch (error: unknown) {
      if (error instanceof ApiRequestError && error.code === 'TENANT_NOT_FOUND')
        window.location.replace('/');
      setCookbook(emptyCookbook);
      return emptyCookbook;
    }
  }
  async function applyBrowserLocation(loaded: CookbookResponse): Promise<void> {
    if (categoryEditorPath() || recipeEditorPath() !== null) {
      setSelectedCategoryId(null);
      setSelectedRecipe(null);
      setRecipeError('');
      return;
    }
    const location: CookbookLocation = resolveCookbookLocation(loaded, window.location.pathname);
    setSelectedCategoryId(location.categoryId);
    setSelectedRecipe(null);
    setRecipeError('');
    if (location.recipe === null) return;
    try {
      setSelectedRecipe(
        await request<RecipeDetail>(
          `/cookbook/recipes/${location.recipe.public_id}${location.variantSlug === null ? '' : `?variant=${encodeURIComponent(location.variantSlug)}`}`,
        ),
      );
    } catch (_error: unknown) {
      setRecipeError(text.dashboard.recipeLoadFailed);
    }
  }
  if (screen === 'loading')
    return (
      <section className="panel loading-panel" aria-live="polite">
        {text.loading}
      </section>
    );
  if (screen === 'change-password')
    return (
      <PasswordChangeScreen
        text={text}
        hasPassword={hasPassword}
        currentPassword={currentPassword}
        newPassword={newPassword}
        repeatPassword={repeatPassword}
        isSubmitting={isSubmitting}
        message={message}
        onSubmit={changePassword}
        onCurrentPasswordChange={onValueChange(setCurrentPassword)}
        onNewPasswordChange={onValueChange(setNewPassword)}
        onRepeatPasswordChange={onValueChange(setRepeatPassword)}
      />
    );
  if (screen === 'dashboard')
    return shareToken !== null ? (
      <SharedRecipeView token={shareToken} text={text} />
    ) : editorPath === 'manage' && !cookbook.canManageRecipes && !cookbook.canManageCategories ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath === 'manage-users' && !cookbook.canManageUsers ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath === 'manage-ingredients' && !cookbook.canManageIngredients ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath === 'manage-units' && !cookbook.canManageUnits ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath === 'manage-recipe-policy' && !cookbook.canManageUsers ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath === 'manage-service-accounts' && !cookbook.canManageServiceAccounts ? (
      <AccessDeniedScreen text={text} />
    ) : isCategoryEditor && !cookbook.canManageCategories ? (
      <AccessDeniedScreen text={text} />
    ) : editorPath !== null &&
      editorPath !== 'manage' &&
      editorPath !== 'manage-users' &&
      editorPath !== 'manage-recipe-policy' &&
      !cookbook.canManageRecipes ? (
      <AccessDeniedScreen text={text} />
    ) : (
      <section
        className={isCategoryEditor || editorPath !== null ? 'tenant-management' : 'tenant-content'}
      >
        {isCategoryEditor || editorPath !== null ? (
          <button
            type="button"
            className="button--secondary tenant-management__back"
            onClick={closeTenantManagement}
          >
            {text.tenantNavigation.backToCookbook}
          </button>
        ) : null}
        <div className={isCategoryEditor || editorPath !== null ? 'tenant-area' : undefined}>
          {isCategoryEditor || editorPath !== null ? (
            <TenantNavigation
              text={text}
              cookbook={cookbook}
              activeView={
                isCategoryEditor
                  ? 'categories'
                  : editorPath === 'manage'
                    ? 'none'
                    : editorPath === 'drafts'
                      ? 'drafts'
                      : editorPath === 'manage-recipes'
                        ? 'recipes'
                        : editorPath === 'manage-users'
                          ? 'users'
                          : editorPath === 'manage-ingredients'
                            ? 'ingredients'
                            : editorPath === 'manage-units'
                              ? 'units'
                              : editorPath === 'manage-recipe-policy'
                                ? 'settings'
                                : editorPath === 'manage-service-accounts'
                                  ? 'service-accounts'
                                  : editorPath !== null
                                    ? 'editor'
                                    : 'recipes'
              }
              onOpenRecipes={openRecipes}
              onOpenDrafts={openDrafts}
              onOpenCategories={openCategoryEditor}
              onOpenUsers={openUsers}
              onOpenIngredients={openIngredients}
              onOpenUnits={openUnits}
              onOpenSettings={openRecipePolicy}
              onOpenServiceAccounts={openServiceAccounts}
              onCreateRecipe={(): void => openRecipeEditor(null)}
            />
          ) : null}
          <div className="tenant-content">
            {editorPath === 'manage' ? (
              <ManagementPlaceholder text={text} />
            ) : editorPath === 'manage-users' && tenantSlugFromPath() !== null ? (
              <TenantUserManagement locale={locale} tenantSlug={tenantSlugFromPath()!} />
            ) : editorPath === 'manage-ingredients' && tenantSlugFromPath() !== null ? (
              <TenantIngredientManagement locale={locale} tenantSlug={tenantSlugFromPath()!} />
            ) : editorPath === 'manage-units' && tenantSlugFromPath() !== null ? (
              <TenantUnitManagement locale={locale} tenantSlug={tenantSlugFromPath()!} />
            ) : editorPath === 'manage-recipe-policy' && tenantSlugFromPath() !== null ? (
              <RecipePolicySettings tenantSlug={tenantSlugFromPath()!} text={text} />
            ) : editorPath === 'manage-service-accounts' && tenantSlugFromPath() !== null ? (
              <ServiceAccountManagement locale={locale} tenantSlug={tenantSlugFromPath()!} />
            ) : isCategoryEditor && tenantSlugFromPath() !== null ? (
              <CategoryEditor
                locale={locale}
                tenantSlug={tenantSlugFromPath()!}
                onChanged={async (): Promise<void> => {
                  await loadCookbook();
                }}
              />
            ) : editorPath === 'drafts' && tenantSlugFromPath() !== null ? (
              <DraftRecipeList
                locale={locale}
                tenantSlug={tenantSlugFromPath()!}
                onEdit={openRecipeEditor}
                onCreate={(): void => openRecipeEditor(null)}
              />
            ) : editorPath === 'manage-recipes' ? (
              <RecipeManagementList
                text={text}
                recipes={cookbook.recipes}
                onEdit={openRecipeEditor}
                onCreate={(): void => openRecipeEditor(null)}
              />
            ) : editorPath !== null && tenantSlugFromPath() !== null ? (
              <RecipeEditor
                locale={locale}
                tenantSlug={tenantSlugFromPath()!}
                recipePublicId={editorPath === 'new' ? null : editorPath}
                categories={cookbook.categories}
                onChanged={loadCookbook}
                onCreated={(publicId: string): void => openRecipeEditor(publicId)}
              />
            ) : (
              <>
                <CookbookDashboard
                  text={text}
                  cookbook={cookbook}
                  selectedCategoryId={selectedCategoryId}
                  selectedRecipe={selectedRecipe}
                  isRecipeLoading={isRecipeLoading}
                  recipeError={recipeError}
                  onSelectCategory={selectCategory}
                  onSelectRecipe={openRecipe}
                  onCloseRecipe={closeRecipe}
                  onEditRecipe={editSelectedRecipe}
                  onShareRecipe={openSelectedRecipeShareDialog}
                  onShareRecipeWithAi={openSelectedRecipeAiContext}
                  onShareCategoryWithAi={openCategoryAiContext}
                  onShareCookbookWithAi={openCookbookAiContext}
                  onSelectVariant={selectRecipeVariant}
                  onManageCookbook={openDrafts}
                />
                {aiContextTarget === null ? null : (
                  <AiContextDialog
                    text={text}
                    targetType={aiContextTarget.type}
                    targetPublicId={aiContextTarget.publicId}
                    targetName={aiContextTarget.name}
                    tenantSlug={tenantSlugFromPath() ?? ''}
                    onClose={(): void => setAiContextTarget(null)}
                    onError={(): void => setRecipeError(text.errors.requestFailed)}
                  />
                )}
                {isDetailShareDialogOpen ? (
                  <RecipeShareDialog
                    text={text}
                    links={detailShareLinks}
                    isSaving={false}
                    onClose={(): void => setIsDetailShareDialogOpen(false)}
                    onCreate={createSelectedRecipeShareLink}
                    onCopy={copySelectedRecipeShareLink}
                    onRevoke={revokeSelectedRecipeShareLink}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
    );
  return (
    <LoginScreen
      text={text}
      email={email}
      password={password}
      emailCode={emailCode}
      methods={methods}
      isSubmitting={isSubmitting}
      message={message}
      onSubmit={login}
      onRequestCode={requestCode}
      onVerifyCode={verifyCode}
      onRequestPasswordReset={requestPasswordReset}
      onEmailChange={(event: ChangeEvent<HTMLInputElement>): void => {
        setEmail(event.currentTarget.value);
        setEmailCode('');
      }}
      onPasswordChange={onValueChange(setPassword)}
      onCodeChange={setEmailCode}
    />
  );
}

function onValueChange(
  setValue: (value: string) => void,
): (event: ChangeEvent<HTMLInputElement>) => void {
  return (event: ChangeEvent<HTMLInputElement>): void => setValue(event.currentTarget.value);
}
function isLoginPath(): boolean {
  return window.location.pathname === loginPath;
}
function postLoginPath(): string {
  if (!isLoginPath()) return `${window.location.pathname}${window.location.search}`;
  const requestedPath: string | null = new URLSearchParams(window.location.search).get('next');
  return requestedPath !== null &&
    requestedPath.startsWith('/') &&
    !requestedPath.startsWith('//') &&
    !requestedPath.includes('\\')
    ? requestedPath
    : '/';
}
function tenantSlugFromPath(): string | null {
  const segment: string | undefined = window.location.pathname
    .split('/')
    .filter((value: string): boolean => value.length > 0)[0];
  if (
    segment === undefined ||
    [
      'admin',
      'api',
      'assets',
      'auth',
      'health',
      'login',
      'logout',
      'recipes',
      'settings',
      'invitations',
    ].includes(segment)
  )
    return null;
  return decodeURIComponent(segment);
}
function categoryEditorPath(): boolean {
  if (typeof window === 'undefined') return false;
  const segments: string[] = window.location.pathname
    .split('/')
    .filter((value: string): boolean => value.length > 0);
  return segments.length === 2 && segments[1] === 'categories';
}

function recipeEditorPath(): 'manage' | 'new' | 'drafts' | string | null {
  const segments: string[] = window.location.pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  if (segments.length === 2 && segments[1] === 'drafts') return 'drafts';
  if (segments.length === 3 && segments[1] === 'recipes' && segments[2] === 'new') return 'new';
  if (segments.length === 4 && segments[1] === 'recipes' && segments[3] === 'edit')
    return segments[2]!;
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'recipes')
    return 'manage-recipes';
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'users')
    return 'manage-users';
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'ingredients')
    return 'manage-ingredients';
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'units')
    return 'manage-units';
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'recipe-policy')
    return 'manage-recipe-policy';
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'service-accounts')
    return 'manage-service-accounts';
  if (segments.length === 2 && segments[1] === 'manage') return 'manage';
  return null;
}
function sharedRecipeToken(): string | null {
  if (typeof window === 'undefined') return null;
  const segments: string[] = window.location.pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  return segments.length === 3 && segments[0] === 'shared' && segments[1] === 'recipes'
    ? segments[2]!
    : null;
}
function errorMessage(error: unknown, locale: Locale): string {
  const errors: Translation['errors'] = translations[locale].errors;
  if (!(error instanceof ApiRequestError)) return errors.requestFailed;
  const messages: Record<string, string> = {
    AUTHENTICATION_FAILED: errors.authenticationFailed,
    AUTHENTICATION_REQUIRED: errors.authenticationRequired,
    INVALID_CREDENTIALS: errors.invalidCredentials,
    INVALID_LOGIN_BODY: errors.invalidLoginBody,
    INVALID_PASSWORD: errors.invalidPassword,
    INVALID_EMAIL_CODE: errors.invalidEmailCode,
    PASSWORD_LOGIN_DISABLED: errors.passwordLoginDisabled,
    EMAIL_CODE_LOGIN_DISABLED: errors.emailCodeLoginDisabled,
    PASSWORD_CHANGE_REQUIRED: errors.passwordChangeRequired,
    REQUEST_FAILED: errors.requestFailed,
  };
  return messages[error.code] ?? errors.requestFailed;
}
