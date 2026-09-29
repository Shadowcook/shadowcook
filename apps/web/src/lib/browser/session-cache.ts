const cacheLifetimeMilliseconds: number = 15 * 60 * 1000;
const sessionCacheKey: string = 'shadowcook.browser-session.v1';
const adminAccessCacheKey: string = 'shadowcook.admin-access.v1';

export type BrowserSessionState =
  | { authenticated: false }
  | { authenticated: true; email: string; passwordChangeRequired: boolean };

export type AdminAccessState = 'granted' | 'unauthenticated' | 'denied';

interface CachedValue {
  cachedAt: number;
  value: unknown;
}

export function cachedBrowserSession(): BrowserSessionState | null {
  const cached: CachedValue | null = cachedValue(sessionCacheKey);
  if (cached === null || !isBrowserSessionState(cached.value)) return null;
  return cached.value;
}

export function cacheBrowserSession(session: BrowserSessionState): void {
  cacheValue(sessionCacheKey, session);
}

export function clearBrowserSessionCache(): void {
  const storage: Storage | null = browserStorage();
  if (storage === null) return;
  storage.removeItem(sessionCacheKey);
  clearAdminAccessCache();
}

export function clearAdminAccessCache(): void {
  const storage: Storage | null = browserStorage();
  if (storage === null) return;
  storage.removeItem(adminAccessCacheKey);
}

export function cachedAdminAccess(): AdminAccessState | null {
  const cached: CachedValue | null = cachedValue(adminAccessCacheKey);
  if (
    cached === null ||
    (cached.value !== 'granted' && cached.value !== 'unauthenticated' && cached.value !== 'denied')
  )
    return null;
  return cached.value;
}

export function cacheAdminAccess(access: AdminAccessState): void {
  cacheValue(adminAccessCacheKey, access);
}

function cachedValue(key: string): CachedValue | null {
  const storage: Storage | null = browserStorage();
  if (storage === null) return null;
  const serialized: string | null = storage.getItem(key);
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isCachedValue(value) || Date.now() - value.cachedAt > cacheLifetimeMilliseconds) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch (_error: unknown) {
    storage.removeItem(key);
    return null;
  }
}

function cacheValue(key: string, value: unknown): void {
  const storage: Storage | null = browserStorage();
  if (storage === null) return;
  const cached: CachedValue = { cachedAt: Date.now(), value };
  storage.setItem(key, JSON.stringify(cached));
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function isCachedValue(value: unknown): value is CachedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cachedAt' in value &&
    typeof value.cachedAt === 'number' &&
    'value' in value
  );
}

function isBrowserSessionState(value: unknown): value is BrowserSessionState {
  if (typeof value !== 'object' || value === null || !('authenticated' in value)) return false;
  if (value.authenticated === false) return true;
  return (
    value.authenticated === true &&
    'email' in value &&
    typeof value.email === 'string' &&
    'passwordChangeRequired' in value &&
    typeof value.passwordChangeRequired === 'boolean'
  );
}
