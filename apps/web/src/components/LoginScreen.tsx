import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import RecipeDetailView from './RecipeDetailView';
import BreadcrumbBar from './BreadcrumbBar';
import type { Category, CookbookResponse, Recipe, RecipeDetail } from './cookbook-types';
import { cookbookPath, resolveCookbookLocation } from './cookbook-routing';
import '../styles/cookbook.css';

interface LoginScreenProperties { locale: Locale; }
interface SessionResponse { email: string; passwordChangeRequired: boolean; }
interface LoginResponse { passwordChangeRequired: boolean; }
interface AuthenticationMethods { password: boolean; emailCode: boolean; }
type Screen = 'loading' | 'login' | 'change-password' | 'dashboard';

const loginPath: string = '/login';

export default function LoginScreen({ locale }: LoginScreenProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [screen, setScreen] = useState<Screen>('loading');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [emailCode, setEmailCode] = useState<string>('');
  const [methods, setMethods] = useState<AuthenticationMethods>({ password: true, emailCode: true });
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [cookbook, setCookbook] = useState<CookbookResponse>({ tenant: null, categories: [], recipes: [] });
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(null);
  const [isRecipeLoading, setIsRecipeLoading] = useState<boolean>(false);
  const [recipeError, setRecipeError] = useState<string>('');

  useEffect((): void => { void restoreSession(setEmail, setScreen, setCookbook, setIsAuthenticated, setSelectedCategoryId, setSelectedRecipe, setRecipeError, locale); void request<AuthenticationMethods>('/auth/authentication-methods').then(setMethods).catch((): void => undefined); }, []);
  useEffect((): (() => void) => {
    function restoreLocation(): void { void applyBrowserLocation(cookbook, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); }
    window.addEventListener('popstate', restoreLocation);
    return (): void => window.removeEventListener('popstate', restoreLocation);
  }, [cookbook, locale]);

  async function login(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setMessage(''); setIsSubmitting(true);
    try {
      const response: LoginResponse = await request<LoginResponse>('/auth/login', jsonRequest({ email, password }));
      if (response.passwordChangeRequired) { setScreen('change-password'); return; }
      window.history.replaceState(null, '', '/'); const cookbook: CookbookResponse = await loadCookbook(setCookbook); await applyBrowserLocation(cookbook, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); setIsAuthenticated(true); setScreen('dashboard');
    } catch (error: unknown) { setMessage(errorMessage(error, locale)); } finally { setIsSubmitting(false); }
  }

  async function changePassword(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setMessage(''); setIsSubmitting(true);
    try {
      await request<void>('/auth/change-password', jsonRequest({ currentPassword, newPassword }));
      setCurrentPassword(''); setNewPassword(''); window.history.replaceState(null, '', '/'); const cookbook: CookbookResponse = await loadCookbook(setCookbook); await applyBrowserLocation(cookbook, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); setIsAuthenticated(true); setScreen('dashboard');
    } catch (error: unknown) { setMessage(errorMessage(error, locale)); } finally { setIsSubmitting(false); }
  }
  async function requestCode(): Promise<void> { setMessage(''); setIsSubmitting(true); try { await request<void>('/auth/email-code/request', jsonRequest({ email })); setMessage(text.login.codeSent); } catch (error: unknown) { setMessage(errorMessage(error, locale)); } finally { setIsSubmitting(false); } }
  async function verifyCode(event: SubmitEvent<HTMLFormElement>): Promise<void> { event.preventDefault(); setMessage(''); setIsSubmitting(true); try { const response: LoginResponse = await request<LoginResponse>('/auth/email-code/verify', jsonRequest({ email, code: emailCode })); if (response.passwordChangeRequired) { setScreen('change-password'); return; } window.history.replaceState(null, '', '/'); const loaded: CookbookResponse = await loadCookbook(setCookbook); await applyBrowserLocation(loaded, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); setIsAuthenticated(true); setScreen('dashboard'); } catch (error: unknown) { setMessage(errorMessage(error, locale)); } finally { setIsSubmitting(false); } }

  async function logout(): Promise<void> {
    try { await request<void>('/auth/logout', { method: 'POST' }); } catch (error: unknown) { setMessage(errorMessage(error, locale)); return; }
    setPassword(''); setMessage(''); setSelectedCategoryId(null); setIsAuthenticated(false); window.history.pushState(null, '', '/'); await loadCookbook(setCookbook); setScreen('dashboard');
  }

  if (screen === 'loading') return <section className="panel loading-panel" aria-live="polite">{text.loading}</section>;
  if (screen === 'change-password') return <PasswordChangeScreen text={text} currentPassword={currentPassword} newPassword={newPassword} isSubmitting={isSubmitting} message={message} onSubmit={changePassword} onCurrentPasswordChange={onValueChange(setCurrentPassword)} onNewPasswordChange={onValueChange(setNewPassword)} />;
  async function openRecipe(publicId: string): Promise<void> {
    setRecipeError(''); setIsRecipeLoading(true);
    try {
      const recipe: RecipeDetail = await request<RecipeDetail>(`/cookbook/recipes/${publicId}`);
      setSelectedRecipe(recipe);
      const overviewRecipe: Recipe | undefined = cookbook.recipes.find((candidate: Recipe): boolean => candidate.public_id === publicId);
      if (overviewRecipe !== undefined) { const slug: string | null = tenantSlugFromPath(); if (slug !== null) window.history.pushState(null, '', cookbookPath(slug, cookbook.categories, selectedCategoryId, overviewRecipe)); }
    } catch (_error: unknown) { setRecipeError(text.dashboard.recipeLoadFailed); } finally { setIsRecipeLoading(false); }
  }

  function selectCategory(categoryId: string | null): void {
    setSelectedRecipe(null); setSelectedCategoryId(categoryId); setRecipeError(''); const slug: string | null = tenantSlugFromPath(); if (slug !== null) window.history.pushState(null, '', cookbookPath(slug, cookbook.categories, categoryId, null));
  }
  function closeRecipe(): void {
    setSelectedRecipe(null); setRecipeError(''); const slug: string | null = tenantSlugFromPath(); if (slug !== null) window.history.pushState(null, '', cookbookPath(slug, cookbook.categories, selectedCategoryId, null));
  }
  function openLogin(): void {
    setMessage(''); window.history.pushState(null, '', loginPath); setScreen('login');
  }

  if (screen === 'dashboard') return <CookbookDashboard text={text} email={email} cookbook={cookbook} isAuthenticated={isAuthenticated} selectedCategoryId={selectedCategoryId} selectedRecipe={selectedRecipe} isRecipeLoading={isRecipeLoading} recipeError={recipeError} onSelectCategory={selectCategory} onSelectRecipe={openRecipe} onCloseRecipe={closeRecipe} onLogin={openLogin} onLogout={logout} />;
  return <LoginForm text={text} email={email} password={password} emailCode={emailCode} methods={methods} isSubmitting={isSubmitting} message={message} onSubmit={login} onRequestCode={requestCode} onVerifyCode={verifyCode} onEmailChange={onValueChange(setEmail)} onPasswordChange={onValueChange(setPassword)} onCodeChange={setEmailCode} />;
}

interface LoginFormProperties { text: Translation; email: string; password: string; emailCode: string; methods: AuthenticationMethods; isSubmitting: boolean; message: string; onSubmit: (event: SubmitEvent<HTMLFormElement>) => void; onRequestCode: () => Promise<void>; onVerifyCode: (event: SubmitEvent<HTMLFormElement>) => void; onEmailChange: (event: ChangeEvent<HTMLInputElement>) => void; onPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void; onCodeChange: (value: string) => void; }
type LoginStep = 'email' | 'code' | 'password';
function LoginForm(properties: LoginFormProperties): JSX.Element {
  const { text, email, password, emailCode, methods, isSubmitting, message, onSubmit, onRequestCode, onVerifyCode, onEmailChange, onPasswordChange, onCodeChange } = properties;
  const [step, setStep] = useState<LoginStep>('email');
  async function continueWithEmail(event: SubmitEvent<HTMLFormElement>): Promise<void> { event.preventDefault(); if (methods.emailCode) { await onRequestCode(); setStep('code'); } else setStep('password'); }
  function submit(event: SubmitEvent<HTMLFormElement>): void { if (step === 'email') void continueWithEmail(event); else if (step === 'code') onVerifyCode(event); else onSubmit(event); }
  return <section className="panel auth-panel"><p className="eyebrow">{text.login.title}</p><h1>{text.login.title}</h1><p className="lede">{text.login.subtitle}</p><form onSubmit={submit}>{step === 'email' ? <label>{text.login.emailLabel}<input value={email} onChange={onEmailChange} type="email" autoComplete="email" required autoFocus /></label> : null}{step === 'code' ? <><p className="hint">{text.login.codeSent}</p><CodeBoxes value={emailCode} label={text.login.emailCodeLabel} onChange={onCodeChange} /><button className="button--secondary" type="button" onClick={() => setStep('email')}>{text.login.changeEmail}</button>{methods.password ? <button className="button--secondary" type="button" onClick={() => setStep('password')}>{text.login.usePasswordInstead}</button> : null}</> : null}{step === 'password' ? <label>{text.login.passwordLabel}<input value={password} onChange={onPasswordChange} type="password" autoComplete="current-password" required autoFocus /></label> : null}<button type="submit" disabled={isSubmitting}>{step === 'email' ? text.login.requestCode : step === 'code' ? text.login.verifyCode : isSubmitting ? text.login.submitting : text.login.submit}</button></form><StatusMessage message={message} />{step === 'email' ? <p className="hint">{text.login.developmentCredentials}</p> : null}</section>;
}
function CodeBoxes({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }): JSX.Element { const digits: string[] = Array.from({ length: 6 }, (_item: unknown, index: number): string => value[index] ?? ''); function update(index: number, input: string): void { const digit: string = input.replace(/\D/g, '').slice(-1); const next: string[] = digits.slice(); next[index] = digit; onChange(next.join('')); if (digit.length === 1 && index < 5) document.getElementById(`email-code-${index + 1}`)?.focus(); } return <fieldset><legend>{label}</legend><div className="code-boxes">{digits.map((digit: string, index: number): JSX.Element => <input aria-label={`${label} ${index + 1}`} id={`email-code-${index}`} key={index} value={digit} onChange={(event: ChangeEvent<HTMLInputElement>): void => update(index, event.currentTarget.value)} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} required />)}</div></fieldset>; }

interface PasswordChangeProperties { text: Translation; currentPassword: string; newPassword: string; isSubmitting: boolean; message: string; onSubmit: (event: SubmitEvent<HTMLFormElement>) => void; onCurrentPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void; onNewPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void; }
function PasswordChangeScreen(properties: PasswordChangeProperties): JSX.Element { const { text, currentPassword, newPassword, isSubmitting, message, onSubmit, onCurrentPasswordChange, onNewPasswordChange } = properties; return <section className="panel auth-panel"><p className="eyebrow">{text.passwordChange.title}</p><h1>{text.passwordChange.title}</h1><p className="lede">{text.passwordChange.subtitle}</p><form onSubmit={onSubmit}><label>{text.passwordChange.currentPasswordLabel}<input value={currentPassword} onChange={onCurrentPasswordChange} type="password" autoComplete="current-password" /></label><label>{text.passwordChange.newPasswordLabel}<input value={newPassword} onChange={onNewPasswordChange} type="password" minLength={12} autoComplete="new-password" required /></label><button type="submit" disabled={isSubmitting}>{isSubmitting ? text.passwordChange.submitting : text.passwordChange.submit}</button></form><StatusMessage message={message} /></section>; }

interface DashboardProperties { text: Translation; email: string; cookbook: CookbookResponse; isAuthenticated: boolean; selectedCategoryId: string | null; selectedRecipe: RecipeDetail | null; isRecipeLoading: boolean; recipeError: string; onSelectCategory: (categoryId: string | null) => void; onSelectRecipe: (publicId: string) => Promise<void>; onCloseRecipe: () => void; onLogin: () => void; onLogout: () => Promise<void>; }
function CookbookDashboard(properties: DashboardProperties): JSX.Element {
  const { text, email, cookbook, isAuthenticated, selectedCategoryId, selectedRecipe, isRecipeLoading, recipeError, onSelectCategory, onSelectRecipe, onCloseRecipe, onLogin, onLogout } = properties;
  const categoryNames: Map<string, string> = new Map(cookbook.categories.map((category: Category): [string, string] => [category.public_id, category.name]));
  const recipes: Recipe[] = selectedCategoryId === null ? cookbook.recipes : cookbook.recipes.filter((recipe: Recipe): boolean => recipe.category_public_ids.includes(selectedCategoryId));
  const cookbookName: string = cookbook.tenant?.display_name ?? text.dashboard.cookbook;
  return <section className="dashboard"><header className="dashboard__header"><div><p className="eyebrow">{cookbookName}</p><h1>{text.dashboard.greeting}</h1></div><div className="account">{isAuthenticated ? <><span>{email}</span><button className="button--secondary" type="button" onClick={() => void onLogout()}>{text.dashboard.logout}</button></> : <button className="button--secondary" type="button" onClick={onLogin}>{text.dashboard.login}</button>}</div></header><BreadcrumbBar categories={cookbook.categories} selectedCategoryId={selectedCategoryId} selectedRecipe={selectedRecipe} cookbookName={cookbookName} text={text} onSelectCategory={onSelectCategory} />{selectedRecipe !== null ? <RecipeDetailView text={text} recipe={selectedRecipe} onClose={onCloseRecipe} /> : <div className="cookbook-layout"><aside className="category-panel"><p className="eyebrow">{text.dashboard.categories}</p><button className={selectedCategoryId === null ? 'category-button category-button--active' : 'category-button'} type="button" onClick={() => onSelectCategory(null)}>{text.dashboard.allCategories}</button><CategoryTree categories={cookbook.categories} selectedCategoryId={selectedCategoryId} text={text} onSelectCategory={onSelectCategory} /></aside><section className="recipes-panel"><div className="recipes-panel__heading"><p className="eyebrow">{text.dashboard.recipes}</p><strong>{recipes.length}</strong></div>{recipeError.length > 0 ? <p className="message" role="alert">{recipeError}</p> : null}{isRecipeLoading ? <p className="empty-state" aria-live="polite">{text.loading}</p> : null}{recipes.length === 0 ? <p className="empty-state">{text.dashboard.noRecipes}</p> : <div className="recipe-grid">{recipes.map((recipe: Recipe): JSX.Element => <article className="recipe-card" key={recipe.public_id}><button className="recipe-card__button" type="button" onClick={() => void onSelectRecipe(recipe.public_id)}><h2>{recipe.title}</h2>{recipe.summary === null ? null : <p>{recipe.summary}</p>}<div className="recipe-card__categories">{recipe.category_public_ids.length === 0 ? <span>{text.dashboard.uncategorized}</span> : recipe.category_public_ids.map((categoryId: string): JSX.Element => <span key={categoryId}>{categoryNames.get(categoryId) ?? text.dashboard.uncategorized}</span>)}</div></button></article>)}</div>}</section></div>}</section>;
}


interface CategoryTreeProperties { categories: readonly Category[]; selectedCategoryId: string | null; text: Translation; onSelectCategory: (categoryId: string) => void; }
function CategoryTree(properties: CategoryTreeProperties): JSX.Element {
  const { categories, selectedCategoryId, text, onSelectCategory } = properties;
  const byParentId: Map<string | null, Category[]> = new Map();
  for (const category of categories) {
    const siblings: Category[] = byParentId.get(category.parent_public_id) ?? [];
    siblings.push(category);
    byParentId.set(category.parent_public_id, siblings);
  }
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<ReadonlySet<string>>(new Set<string>());
  useEffect((): void => {
    if (selectedCategoryId === null) return;
    setExpandedCategoryIds((current: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...current, ...ancestorCategoryIds(categories, selectedCategoryId)]));
  }, [categories, selectedCategoryId]);
  function toggleCategory(categoryId: string): void {
    setExpandedCategoryIds((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set(current);
      if (next.has(categoryId)) { next.delete(categoryId); } else { next.add(categoryId); }
      return next;
    });
  }
  return <div className="category-tree">{categoryTreeItems(null, byParentId, expandedCategoryIds, selectedCategoryId, text, onSelectCategory, toggleCategory)}</div>;
}

function categoryTreeItems(parentId: string | null, byParentId: Map<string | null, Category[]>, expandedCategoryIds: ReadonlySet<string>, selectedCategoryId: string | null, text: Translation, onSelectCategory: (categoryId: string) => void, onToggleCategory: (categoryId: string) => void): JSX.Element[] {
  const children: Category[] = byParentId.get(parentId) ?? [];
  children.sort((left: Category, right: Category): number => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  return children.map((category: Category): JSX.Element => {
    const descendants: Category[] = byParentId.get(category.public_id) ?? [];
    const isExpanded: boolean = expandedCategoryIds.has(category.public_id);
    const hasDescendants: boolean = descendants.length > 0;
    const disclosureLabel: string = `${isExpanded ? text.dashboard.collapseCategory : text.dashboard.expandCategory}: ${category.name}`;
    return <div className="category-tree__item" key={category.public_id}><div className="category-tree__row">{hasDescendants ? <button aria-expanded={isExpanded} aria-label={disclosureLabel} className="category-disclosure" type="button" onClick={() => onToggleCategory(category.public_id)}>{isExpanded ? '−' : '+'}</button> : <span className="category-disclosure category-disclosure--placeholder" aria-hidden="true" />}<button className={selectedCategoryId === category.public_id ? 'category-button category-button--active' : 'category-button'} type="button" onClick={() => onSelectCategory(category.public_id)}>{category.name}</button></div>{hasDescendants && isExpanded ? <div className="category-tree__children">{categoryTreeItems(category.public_id, byParentId, expandedCategoryIds, selectedCategoryId, text, onSelectCategory, onToggleCategory)}</div> : null}</div>;
  });
}

function ancestorCategoryIds(categories: readonly Category[], categoryId: string): string[] {
  const ancestors: string[] = [];
  let current: Category | undefined = categories.find((category: Category): boolean => category.public_id === categoryId);
  while (current?.parent_public_id !== null && current?.parent_public_id !== undefined) {
    ancestors.push(current.parent_public_id);
    current = categories.find((category: Category): boolean => category.public_id === current?.parent_public_id);
  }
  return ancestors;
}

function onValueChange(setValue: (value: string) => void): (event: ChangeEvent<HTMLInputElement>) => void { return (event: ChangeEvent<HTMLInputElement>): void => setValue(event.currentTarget.value); }
function StatusMessage({ message }: { message: string }): JSX.Element | null { return message.length === 0 ? null : <p className="message" role="alert">{message}</p>; }
function jsonRequest(body: object): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
async function restoreSession(setEmail: (value: string) => void, setScreen: (screen: Screen) => void, setCookbook: (cookbook: CookbookResponse) => void, setIsAuthenticated: (value: boolean) => void, setSelectedCategoryId: (categoryId: string | null) => void, setSelectedRecipe: (recipe: RecipeDetail | null) => void, setRecipeError: (message: string) => void, locale: Locale): Promise<void> { try { const response: SessionResponse = await request<SessionResponse>('/auth/session'); setEmail(response.email); if (response.passwordChangeRequired) { setScreen('change-password'); return; } if (isLoginPath()) window.history.replaceState(null, '', '/'); const cookbook: CookbookResponse = await loadCookbook(setCookbook); await applyBrowserLocation(cookbook, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); setIsAuthenticated(true); setScreen('dashboard'); } catch (_error: unknown) { if (isLoginPath()) { setScreen('login'); return; } const cookbook: CookbookResponse = await loadCookbook(setCookbook); await applyBrowserLocation(cookbook, locale, setSelectedCategoryId, setSelectedRecipe, setRecipeError); setScreen('dashboard'); } }
function isLoginPath(): boolean { return window.location.pathname === loginPath; }
function tenantSlugFromPath(): string | null { const segment: string | undefined = window.location.pathname.split('/').filter((value: string): boolean => value.length > 0)[0]; if (segment === undefined || ['admin', 'api', 'assets', 'auth', 'health', 'login', 'logout', 'recipes', 'settings', 'invitations'].includes(segment)) return null; return decodeURIComponent(segment); }
async function loadCookbook(setCookbook: (cookbook: CookbookResponse) => void, slug: string | null = tenantSlugFromPath()): Promise<CookbookResponse> { const empty: CookbookResponse = { tenant: null, categories: [], recipes: [] }; if (slug === null) { setCookbook(empty); return empty; } try { const response: CookbookResponse = await request<CookbookResponse>(`/cookbook?tenantSlug=${encodeURIComponent(slug)}`); setCookbook(response); return response; } catch (error: unknown) { if (error instanceof ApiRequestError && error.code === 'TENANT_NOT_FOUND') window.location.replace('/'); setCookbook(empty); return empty; } }
async function applyBrowserLocation(cookbook: CookbookResponse, locale: Locale, setSelectedCategoryId: (categoryId: string | null) => void, setSelectedRecipe: (recipe: RecipeDetail | null) => void, setRecipeError: (message: string) => void): Promise<void> { const location = resolveCookbookLocation(cookbook, window.location.pathname); setSelectedCategoryId(location.categoryId); setSelectedRecipe(null); setRecipeError(''); if (location.recipe === null) return; try { const recipe: RecipeDetail = await request<RecipeDetail>(`/cookbook/recipes/${location.recipe.public_id}`); setSelectedRecipe(recipe); } catch (_error: unknown) { setRecipeError(translations[locale].dashboard.recipeLoadFailed); } }
async function request<ResponseBody>(path: string, options?: RequestInit): Promise<ResponseBody> { const response: Response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options }); if (response.status === 204) return undefined as ResponseBody; const body: unknown = await response.json().catch((): null => null); if (!response.ok) throw new ApiRequestError(errorCodeFromBody(body)); return body as ResponseBody; }
class ApiRequestError extends Error { public readonly code: string; public constructor(code: string) { super(code); this.code = code; } }
function errorCodeFromBody(body: unknown): string { return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : 'REQUEST_FAILED'; }
function errorMessage(error: unknown, locale: Locale): string { const errors = translations[locale].errors; if (!(error instanceof ApiRequestError)) return errors.requestFailed; const messages: Record<string, string> = { AUTHENTICATION_FAILED: errors.authenticationFailed, AUTHENTICATION_REQUIRED: errors.authenticationRequired, INVALID_CREDENTIALS: errors.invalidCredentials, INVALID_LOGIN_BODY: errors.invalidLoginBody, INVALID_PASSWORD: errors.invalidPassword, INVALID_EMAIL_CODE: errors.invalidEmailCode, PASSWORD_LOGIN_DISABLED: errors.passwordLoginDisabled, EMAIL_CODE_LOGIN_DISABLED: errors.emailCodeLoginDisabled, PASSWORD_CHANGE_REQUIRED: errors.passwordChangeRequired, REQUEST_FAILED: errors.requestFailed }; return messages[error.code] ?? errors.requestFailed; }
