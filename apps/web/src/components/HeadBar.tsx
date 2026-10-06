import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import AdminIcon from './AdminIcon';

interface Properties {
  locale: Locale;
}

interface SessionResponse {
  email: string;
}

type SessionState =
  | { authenticated: false }
  | { authenticated: true; email: string; canAccessAdministration: boolean };

const signedOut: SessionState = { authenticated: false };

export default function HeadBar({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [session, setSession] = useState<SessionState>(signedOut);
  const [signInHref, setSignInHref] = useState<string>('/login');
  const [signOutError, setSignOutError] = useState<string>('');
  const [signingOut, setSigningOut] = useState<boolean>(false);

  useEffect((): void => {
    void restoreSession(setSession);
    setSignInHref(loginHref());
  }, []);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError('');
    const abortController: AbortController = new AbortController();
    const timeoutId: number = window.setTimeout((): void => abortController.abort(), 10000);
    try {
      const response: Response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        signal: abortController.signal,
      });
      if (!response.ok) {
        console.error('Sign-out request returned an unsuccessful response.', {
          status: response.status,
        });
        setSignOutError(text.headBar.signOutFailed);
        return;
      }
    } catch (error: unknown) {
      console.error('Sign-out request failed.', {
        name: error instanceof Error ? error.name : 'unknown',
      });
      setSignOutError(text.headBar.signOutFailed);
      return;
    } finally {
      window.clearTimeout(timeoutId);
      setSigningOut(false);
    }
    clearBrowserSessionCache();
    window.location.assign('/');
  }

  return (
    <header className="head-bar">
      <a className="head-bar__home" href="/" aria-label={text.accessibility.applicationName}>
        <img className="head-bar__logo" src="/shadowcook-logo.png" alt="" aria-hidden="true" />
        {text.brandName}
      </a>
      {session.authenticated ? (
        <details className="head-bar__user-menu">
          <summary aria-label={text.headBar.userMenu}>
            {session.email}
            <AdminIcon name="expand" />
          </summary>
          <div className="head-bar__menu" role="menu">
            {session.canAccessAdministration ? (
              <a href="/admin" role="menuitem">
                {text.admin.title}
              </a>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={(): void => void signOut()}
            >
              {text.dashboard.logout}
            </button>
            {signOutError.length === 0 ? null : (
              <p className="head-bar__menu-message" role="alert">
                {signOutError}
              </p>
            )}
          </div>
        </details>
      ) : (
        <div className="head-bar__actions">
          <a className="button--secondary" href="/register">
            {text.headBar.register}
          </a>
          <a className="button--secondary" href={signInHref}>
            {text.dashboard.login}
          </a>
        </div>
      )}
    </header>
  );
}

async function restoreSession(setSession: (session: SessionState) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  } catch (_error: unknown) {
    return;
  }
  if (!response.ok) {
    clearBrowserSessionCache();
    setSession(signedOut);
    return;
  }
  const body: SessionResponse = (await response.json()) as SessionResponse;
  let canAccessAdministration: boolean = false;
  try {
    const administrationResponse: Response = await fetch('/api/admin/tenants', {
      credentials: 'same-origin',
    });
    canAccessAdministration = administrationResponse.ok;
  } catch (_error: unknown) {
    canAccessAdministration = false;
  }
  setSession({
    authenticated: true,
    email: body.email,
    canAccessAdministration,
  });
}

function loginHref(): string {
  if (window.location.pathname === '/login') return '/login';
  const requestedPath: string = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(requestedPath)}`;
}
