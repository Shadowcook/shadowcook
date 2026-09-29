import { useEffect, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import AdminMailSettings from './components/AdminMailSettings';
import AdminAuthenticationSettings from './components/AdminAuthenticationSettings';
import AdminTenantManagement from './components/AdminTenantManagement';
import AdminTenantCreate from './components/AdminTenantCreate';
import AdminUnitManagement from './components/AdminUnitManagement';
import AdminIngredientManagement from './components/AdminIngredientManagement';
import AdminUserManagement from './components/AdminUserManagement';
import AccessDeniedScreen from '../../components/AccessDeniedScreen';
import { translations } from '../../i18n';
import type { Locale, Translation } from '../../i18n';
import { cacheAdminAccess, cachedAdminAccess } from '../../lib/browser/session-cache';
import type { AdminAccessState } from '../../lib/browser/session-cache';

interface Properties {
  locale: Locale;
  path: string;
}
type AccessState = 'loading' | AdminAccessState;

export default function AdminArea({ locale, path }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [access, setAccess] = useState<AccessState>(initialAccessState);
  const [isAdministrator, setIsAdministrator] = useState<boolean>(false);
  const [currentPath, setCurrentPath] = useState<string>(path);
  useEffect((): void => {
    void checkAccess(setAccess);
  }, []);
  useEffect((): void => {
    void checkAdministrator(setIsAdministrator);
  }, []);
  useEffect((): (() => void) => {
    function updatePath(): void {
      setCurrentPath(window.location.pathname);
    }
    window.addEventListener('popstate', updatePath);
    return (): void => window.removeEventListener('popstate', updatePath);
  }, []);
  function navigate(event: MouseEvent<HTMLAnchorElement>, targetPath: string): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    if (window.location.pathname === targetPath) return;
    window.history.pushState(null, '', targetPath);
    setCurrentPath(targetPath);
  }
  if (access === 'loading')
    return (
      <section className="panel loading-panel" aria-live="polite">
        {text.loading}
      </section>
    );
  if (access === 'unauthenticated')
    return (
      <section className="panel">
        <h1>{text.admin.title}</h1>
        <p className="message" role="alert">
          {text.adminMail.signInRequired}
        </p>
        <a className="button-link" href="/login">
          {text.dashboard.login}
        </a>
      </section>
    );
  if (access === 'denied') return <AccessDeniedScreen text={text} />;
  return (
    <section className="admin-area">
      <aside className="admin-navigation">
        <p className="eyebrow">{text.admin.title}</p>
        <nav aria-label={text.admin.title}>
          {isAdministrator ? (
            <a
              className={
                currentPath === '/admin'
                  ? 'admin-navigation__link admin-navigation__link--active'
                  : 'admin-navigation__link'
              }
              href="/admin"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void => navigate(event, '/admin')}
            >
              {text.admin.dashboard}
            </a>
          ) : null}
          <a
            className={
              currentPath.startsWith('/admin/tenants')
                ? 'admin-navigation__link admin-navigation__link--active'
                : 'admin-navigation__link'
            }
            href="/admin/tenants"
            onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
              navigate(event, '/admin/tenants')
            }
          >
            {text.admin.tenants}
          </a>
          {isAdministrator ? (
            <a
              className={
                currentPath.startsWith('/admin/units')
                  ? 'admin-navigation__link admin-navigation__link--active'
                  : 'admin-navigation__link'
              }
              href="/admin/units"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                navigate(event, '/admin/units')
              }
            >
              {text.admin.units}
            </a>
          ) : null}
          {isAdministrator ? (
            <a
              className={
                currentPath.startsWith('/admin/ingredients')
                  ? 'admin-navigation__link admin-navigation__link--active'
                  : 'admin-navigation__link'
              }
              href="/admin/ingredients"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                navigate(event, '/admin/ingredients')
              }
            >
              {text.dashboard.ingredients}
            </a>
          ) : null}
          {isAdministrator ? (
            <a
              className={
                currentPath === '/admin/users'
                  ? 'admin-navigation__link admin-navigation__link--active'
                  : 'admin-navigation__link'
              }
              href="/admin/users"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                navigate(event, '/admin/users')
              }
            >
              {text.admin.users}
            </a>
          ) : null}
          {isAdministrator ? (
            <a
              className={
                currentPath.startsWith('/admin/settings')
                  ? 'admin-navigation__link admin-navigation__link--active'
                  : 'admin-navigation__link'
              }
              href="/admin/settings"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                navigate(event, '/admin/settings')
              }
            >
              {text.admin.settings}
            </a>
          ) : null}
          {isAdministrator && currentPath.startsWith('/admin/settings') ? (
            <>
              <a
                className={
                  currentPath === '/admin/settings/smtp'
                    ? 'admin-navigation__sublink admin-navigation__sublink--active'
                    : 'admin-navigation__sublink'
                }
                href="/admin/settings/smtp"
                onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                  navigate(event, '/admin/settings/smtp')
                }
              >
                {text.admin.smtp}
              </a>
              <a
                className={
                  currentPath === '/admin/settings/authentication'
                    ? 'admin-navigation__sublink admin-navigation__sublink--active'
                    : 'admin-navigation__sublink'
                }
                href="/admin/settings/authentication"
                onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                  navigate(event, '/admin/settings/authentication')
                }
              >
                {text.admin.authentication}
              </a>
            </>
          ) : null}
        </nav>
      </aside>
      <main className="admin-content">{page(currentPath, locale, text, navigate)}</main>
    </section>
  );
}

function initialAccessState(): AccessState {
  return cachedAdminAccess() ?? 'loading';
}

function page(
  path: string,
  locale: Locale,
  text: Translation,
  navigate: (event: MouseEvent<HTMLAnchorElement>, targetPath: string) => void,
): JSX.Element {
  if (path === '/admin/settings/smtp') return <AdminMailSettings locale={locale} />;
  if (path === '/admin/settings/authentication')
    return <AdminAuthenticationSettings locale={locale} />;
  if (path === '/admin/tenants/new') return <AdminTenantCreate locale={locale} />;
  if (path === '/admin/tenants') return <AdminTenantManagement locale={locale} />;
  if (path === '/admin/units') return <AdminUnitManagement locale={locale} />;
  if (path === '/admin/ingredients') return <AdminIngredientManagement locale={locale} />;
  if (path === '/admin/users') return <AdminUserManagement locale={locale} />;
  if (path === '/admin/settings')
    return (
      <section className="admin-page">
        <p className="eyebrow">{text.admin.settings}</p>
        <h1>{text.admin.settingsTitle}</h1>
        <p className="lede">{text.admin.settingsDescription}</p>
        <a
          className="admin-card"
          href="/admin/settings/smtp"
          onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
            navigate(event, '/admin/settings/smtp')
          }
        >
          <span>{text.admin.smtp}</span>
          <strong>{text.admin.openSmtp}</strong>
        </a>
        <a
          className="admin-card"
          href="/admin/settings/authentication"
          onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
            navigate(event, '/admin/settings/authentication')
          }
        >
          <span>{text.admin.authentication}</span>
          <strong>{text.admin.authenticationTitle}</strong>
        </a>
      </section>
    );
  return (
    <AdminPlaceholder
      title={text.admin.dashboardTitle}
      description={text.admin.dashboardDescription}
    />
  );
}

function AdminPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <section className="admin-page">
      <p className="eyebrow">{title}</p>
      <h1>{title}</h1>
      <p className="lede">{description}</p>
    </section>
  );
}
async function checkAccess(setAccess: (value: AccessState) => void): Promise<void> {
  const cached: AdminAccessState | null = cachedAdminAccess();
  if (cached === 'granted' || cached === 'denied') {
    setAccess(cached);
    return;
  }
  const response: Response = await fetch('/api/admin/tenants', {
    credentials: 'same-origin',
  });
  if (response.ok) {
    cacheAdminAccess('granted');
    setAccess('granted');
    return;
  }
  if (response.status === 401) {
    cacheAdminAccess('unauthenticated');
    setAccess('unauthenticated');
    return;
  }
  cacheAdminAccess('denied');
  setAccess('denied');
}
async function checkAdministrator(setAdministrator: (value: boolean) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/instance-roles', {
    credentials: 'same-origin',
  });
  setAdministrator(response.ok);
}
