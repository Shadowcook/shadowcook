import OfflineNotice from './errors/OfflineNotice';
import { withErrorBoundary } from './errors/withErrorBoundary';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  faCompass,
  faRightFromBracket,
  faRightToBracket,
  faUser,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import { logout } from '../lib/api/logout';
import { ApiRequestError } from '../lib/api/client';
import { subscribeToProfileUpdates } from '../lib/browser/profile-events';
import { subscribeToSessionChanges } from '../lib/browser/session-events';
import type { HeadBarSession } from '../lib/server/head-bar-session';
import HeadBarDropdown from './HeadBarDropdown';
import LanguageSwitch from './LanguageSwitch';

const signedOut: HeadBarSession = {
  authenticated: false,
  email: '',
  displayName: '',
  canAccessAdministration: false,
};

interface Properties {
  initialSession?: HeadBarSession;
  locale: Locale;
  currentPath?: string;
}

function HeadBar({
  locale,
  initialSession = signedOut,
  currentPath = '',
}: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [session, setSession] = useState<HeadBarSession>(initialSession);
  const [signInHref, setSignInHref] = useState<string>('/login');
  const [signOutError, setSignOutError] = useState<string>('');
  const [signingOut, setSigningOut] = useState<boolean>(false);

  useEffect((): (() => void) => {
    return subscribeToSessionChanges((): void => {
      void restoreSession(setSession);
    });
  }, []);

  useEffect((): void => {
    void restoreSession(setSession);
    setSignInHref(loginHref());
  }, []);

  useEffect((): (() => void) => {
    return subscribeToProfileUpdates((displayName: string): void => {
      setSession((current: HeadBarSession): HeadBarSession => ({ ...current, displayName }));
    });
  }, []);

  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await logout();
    } catch (error: unknown) {
      console.error('Sign-out request failed.', {
        time: new Date().toISOString(),
        name: error instanceof Error ? error.name : 'unknown',
        status: error instanceof ApiRequestError ? error.status : undefined,
        code: error instanceof ApiRequestError ? error.code : undefined,
        requestId: error instanceof ApiRequestError ? error.requestId : undefined,
      });
      setSignOutError(text.headBar.signOutFailed);
      return;
    } finally {
      setSigningOut(false);
    }
    clearBrowserSessionCache();
    window.location.assign('/');
  }

  return (
    <>
      <OfflineNotice text={text.errorStates} />
      <header className="head-bar">
        <a
          className="head-bar__home"
          href="/"
          aria-label={text.accessibility.applicationName}
          title={text.accessibility.applicationName}
        >
          <img className="head-bar__logo" src="/shadowcook-logo.png" alt="" aria-hidden="true" />
          <span className="head-bar__wordmark">{text.brandName}</span>
        </a>
        <div className="head-bar__controls">
          <a
            className="head-bar__explore head-bar__icon-button"
            href="/explore"
            aria-label={text.headBar.explore}
            title={text.headBar.explore}
            aria-current={currentPath === '/explore' ? 'page' : undefined}
          >
            <FontAwesomeIcon icon={faCompass} aria-hidden="true" />
            <span>{text.headBar.explore}</span>
          </a>
          <LanguageSwitch locale={locale} />
          {session.authenticated ? (
            <>
              <HeadBarDropdown label={text.headBar.userMenu} icon={faUser}>
                <div className="head-bar__user-identity">
                  <strong>{session.displayName}</strong>
                  <span>{session.email}</span>
                </div>
                <a href="/explore">{text.headBar.myCookbooks}</a>
                <a href="/settings">{text.headBar.accountSettings}</a>
                {session.canAccessAdministration ? <a href="/admin">{text.admin.title}</a> : null}
              </HeadBarDropdown>
              <div className="head-bar__sign-out">
                <button
                  className="head-bar__icon-button"
                  type="button"
                  aria-label={text.dashboard.logout}
                  title={text.dashboard.logout}
                  aria-busy={signingOut}
                  disabled={signingOut}
                  onClick={(): void => void signOut()}
                >
                  <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
                </button>
                {signOutError.length === 0 ? null : (
                  <p className="head-bar__sign-out-error" role="alert">
                    {signOutError}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="head-bar__actions">
              <a
                className="head-bar__text-button head-bar__register"
                href="/register"
                aria-label={text.headBar.register}
                title={text.headBar.register}
              >
                <FontAwesomeIcon
                  className="head-bar__action-icon"
                  icon={faUserPlus}
                  aria-hidden="true"
                />
                {text.headBar.register}
              </a>
              <a
                className="head-bar__text-button head-bar__sign-in"
                href={signInHref}
                aria-label={text.dashboard.login}
                title={text.dashboard.login}
              >
                <FontAwesomeIcon
                  className="head-bar__action-icon"
                  icon={faRightToBracket}
                  aria-hidden="true"
                />
                {text.dashboard.login}
              </a>
            </div>
          )}
        </div>
      </header>
    </>
  );
}

async function restoreSession(setSession: (session: HeadBarSession) => void): Promise<void> {
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
  const body: { email: string; displayName: string } = (await response.json()) as {
    email: string;
    displayName: string;
  };
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
    displayName: body.displayName,
    canAccessAdministration,
  });
}

function loginHref(): string {
  if (['/', '/explore', '/login'].includes(window.location.pathname)) return '/login';
  const requestedPath: string = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(requestedPath)}`;
}

export default withErrorBoundary(HeadBar);
