import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from './api-client';
import {
  cacheBrowserSession,
  clearAdminAccessCache,
  clearBrowserSessionCache,
} from './browser-session-cache';
import type { BrowserSessionState } from './browser-session-cache';
import CookbookDashboard from './CookbookDashboard';
import CategoryEditor from './CategoryEditor';
import { cookbookPath, resolveCookbookLocation } from './cookbook-routing';
import type { CookbookLocation } from './cookbook-routing';
import type { CookbookResponse, Recipe, RecipeDetail } from './cookbook-types';
import RecipeEditor from './RecipeEditor';
import DraftRecipeList from './DraftRecipeList';
import SharedRecipeView from './SharedRecipeView';
import TenantNavigation from './TenantNavigation';
import RecipeManagementList from './RecipeManagementList';
import LoginScreen from './LoginScreen';
import type { AuthenticationMethods } from './LoginScreen';
import PasswordChangeScreen from './PasswordChangeScreen';
import '../styles/cookbook.css';

interface CookbookScreenProperties {
  locale: Locale;
}
interface SessionResponse {
  email: string;
  passwordChangeRequired: boolean;
}
interface LoginResponse {
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
};

export default function CookbookScreen({ locale }: CookbookScreenProperties): JSX.Element {
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
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [cookbook, setCookbook] = useState<CookbookResponse>(emptyCookbook);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(null);
  const [isRecipeLoading, setIsRecipeLoading] = useState<boolean>(false);
  const [recipeError, setRecipeError] = useState<string>('');
  const [isCategoryEditor, setIsCategoryEditor] = useState<boolean>(false);
  const [editorPath, setEditorPath] = useState<'new' | 'drafts' | string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(sharedRecipeToken());

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

  async function restoreSession(): Promise<void> {
    try {
      const response: SessionResponse = await request<SessionResponse>('/auth/session');
      const session: BrowserSessionState = {
        authenticated: true,
        email: response.email,
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
      setIsAuthenticated(session.authenticated);
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
    if (session.passwordChangeRequired) {
      setScreen('change-password');
      return;
    }
    if (isLoginPath()) {
      window.location.replace('/');
      return;
    }
    const loaded: CookbookResponse = await loadCookbook();
    await applyBrowserLocation(loaded);
    setIsAuthenticated(true);
    setScreen('dashboard');
  }

  async function completeLogin(response: LoginResponse): Promise<void> {
    clearAdminAccessCache();
    cacheBrowserSession({
      authenticated: true,
      email,
      passwordChangeRequired: response.passwordChangeRequired,
    });
    if (response.passwordChangeRequired) {
      setScreen('change-password');
      return;
    }
    window.location.replace('/');
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
  async function changePassword(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    setIsSubmitting(true);
    try {
      await request<void>('/auth/change-password', jsonRequest({ currentPassword, newPassword }));
      setCurrentPassword('');
      setNewPassword('');
      cacheBrowserSession({ authenticated: true, email, passwordChangeRequired: false });
      await completeLogin({ passwordChangeRequired: false });
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  }
  async function logout(): Promise<void> {
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } catch (error: unknown) {
      setMessage(errorMessage(error, locale));
      return;
    }
    setPassword('');
    setEmailCode('');
    setMessage('');
    clearBrowserSessionCache();
    window.location.assign('/');
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
          cookbookPath(slug, cookbook.categories, selectedCategoryId, overviewRecipe),
        );
    } catch (_error: unknown) {
      setRecipeError(text.dashboard.recipeLoadFailed);
    } finally {
      setIsRecipeLoading(false);
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
  function openLogin(): void {
    setMessage('');
    window.history.pushState(null, '', loginPath);
    setScreen('login');
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
  function closeRecipeEditor(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}`);
    setEditorPath(null);
    void loadCookbook();
  }
  function closeCategoryEditor(): void {
    const slug: string | null = tenantSlugFromPath();
    if (slug !== null) window.history.pushState(null, '', `/${slug}`);
    setIsCategoryEditor(false);
    setSelectedCategoryId(null);
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
        await request<RecipeDetail>(`/cookbook/recipes/${location.recipe.public_id}`),
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
        currentPassword={currentPassword}
        newPassword={newPassword}
        isSubmitting={isSubmitting}
        message={message}
        onSubmit={changePassword}
        onCurrentPasswordChange={onValueChange(setCurrentPassword)}
        onNewPasswordChange={onValueChange(setNewPassword)}
      />
    );
  if (screen === 'dashboard')
    return shareToken !== null ? (
      <SharedRecipeView token={shareToken} text={text} />
    ) : (
      <section
        className={isCategoryEditor || editorPath !== null ? 'tenant-area' : 'tenant-content'}
      >
        {isCategoryEditor || editorPath !== null ? (
          <TenantNavigation
            text={text}
            cookbook={cookbook}
            activeView={
              isCategoryEditor
                ? 'categories'
                : editorPath === 'drafts'
                  ? 'drafts'
                  : editorPath === 'manage-recipes'
                    ? 'recipes'
                    : editorPath !== null
                      ? 'editor'
                      : 'recipes'
            }
            onOpenRecipes={openRecipes}
            onOpenDrafts={openDrafts}
            onOpenCategories={openCategoryEditor}
            onCreateRecipe={(): void => openRecipeEditor(null)}
          />
        ) : null}
        <div className="tenant-content">
          {isCategoryEditor && tenantSlugFromPath() !== null ? (
            <CategoryEditor
              locale={locale}
              tenantSlug={tenantSlugFromPath()!}
              onClose={closeCategoryEditor}
              onChanged={async (): Promise<void> => {
                await loadCookbook();
              }}
            />
          ) : editorPath === 'drafts' && tenantSlugFromPath() !== null ? (
            <DraftRecipeList
              locale={locale}
              tenantSlug={tenantSlugFromPath()!}
              onClose={closeRecipeEditor}
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
              onClose={closeRecipeEditor}
              onChanged={loadCookbook}
              onCreated={(publicId: string): void => openRecipeEditor(publicId)}
            />
          ) : (
            <CookbookDashboard
              text={text}
              email={email}
              cookbook={cookbook}
              isAuthenticated={isAuthenticated}
              selectedCategoryId={selectedCategoryId}
              selectedRecipe={selectedRecipe}
              isRecipeLoading={isRecipeLoading}
              recipeError={recipeError}
              onSelectCategory={selectCategory}
              onSelectRecipe={openRecipe}
              onCloseRecipe={closeRecipe}
              onLogin={openLogin}
              onLogout={logout}
              onManageCookbook={openDrafts}
            />
          )}
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

function recipeEditorPath(): 'new' | 'drafts' | string | null {
  const segments: string[] = window.location.pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  if (segments.length === 2 && segments[1] === 'drafts') return 'drafts';
  if (segments.length === 3 && segments[1] === 'recipes' && segments[2] === 'new') return 'new';
  if (segments.length === 4 && segments[1] === 'recipes' && segments[3] === 'edit')
    return segments[2]!;
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'recipes')
    return 'manage-recipes';
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
