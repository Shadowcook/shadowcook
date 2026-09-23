import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import AdminMailSettings from './AdminMailSettings';
import AdminAuthenticationSettings from './AdminAuthenticationSettings';
import TenantSelection from './TenantSelection';
import AdminTenantCreate from './AdminTenantCreate';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';

interface Properties { locale: Locale; path: string; }
type AccessState = 'loading' | 'granted' | 'unauthenticated' | 'denied';

export default function AdminArea({ locale, path }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [access, setAccess] = useState<AccessState>('loading');
  useEffect((): void => { void checkAccess(setAccess); }, []);
  if (access === 'loading') return <section className="panel loading-panel" aria-live="polite">{text.loading}</section>;
  if (access === 'unauthenticated') return <section className="panel"><h1>{text.admin.title}</h1><p className="message" role="alert">{text.adminMail.signInRequired}</p><a className="button-link" href="/login">{text.dashboard.login}</a></section>;
  if (access === 'denied') return <section className="panel"><h1>{text.admin.title}</h1><p className="message" role="alert">{text.adminMail.accessDenied}</p></section>;
  return <section className="admin-area"><aside className="admin-navigation"><p className="eyebrow">{text.admin.title}</p><nav aria-label={text.admin.title}><a className={path === '/admin' ? 'admin-navigation__link admin-navigation__link--active' : 'admin-navigation__link'} href="/admin">{text.admin.dashboard}</a><a className={path.startsWith('/admin/tenants') ? 'admin-navigation__link admin-navigation__link--active' : 'admin-navigation__link'} href="/admin/tenants">{text.admin.tenants}</a><a className={path === '/admin/users' ? 'admin-navigation__link admin-navigation__link--active' : 'admin-navigation__link'} href="/admin/users">{text.admin.users}</a><a className={path.startsWith('/admin/settings') ? 'admin-navigation__link admin-navigation__link--active' : 'admin-navigation__link'} href="/admin/settings">{text.admin.settings}</a>{path.startsWith('/admin/settings') ? <><a className={path === '/admin/settings/smtp' ? 'admin-navigation__sublink admin-navigation__sublink--active' : 'admin-navigation__sublink'} href="/admin/settings/smtp">{text.admin.smtp}</a><a className={path === '/admin/settings/authentication' ? 'admin-navigation__sublink admin-navigation__sublink--active' : 'admin-navigation__sublink'} href="/admin/settings/authentication">{text.admin.authentication}</a></> : null}</nav></aside><main className="admin-content">{page(path, locale, text)}</main></section>;
}

function page(path: string, locale: Locale, text: Translation): JSX.Element {
  if (path === '/admin/settings/smtp') return <AdminMailSettings locale={locale} />;
  if (path === '/admin/settings/authentication') return <AdminAuthenticationSettings locale={locale} />;
  if (path === '/admin/tenants/new') return <AdminTenantCreate locale={locale} />;
  if (path === '/admin/tenants') return <TenantSelection locale={locale} management />;
  if (path === '/admin/users') return <AdminPlaceholder title={text.admin.usersTitle} description={text.admin.usersDescription} />;
  if (path === '/admin/settings') return <section className="admin-page"><p className="eyebrow">{text.admin.settings}</p><h1>{text.admin.settingsTitle}</h1><p className="lede">{text.admin.settingsDescription}</p><a className="admin-card" href="/admin/settings/smtp"><span>{text.admin.smtp}</span><strong>{text.admin.openSmtp}</strong></a><a className="admin-card" href="/admin/settings/authentication"><span>{text.admin.authentication}</span><strong>{text.admin.authenticationTitle}</strong></a></section>;
  return <AdminPlaceholder title={text.admin.dashboardTitle} description={text.admin.dashboardDescription} />;
}

function AdminPlaceholder({ title, description }: { title: string; description: string }): JSX.Element { return <section className="admin-page"><p className="eyebrow">Admin</p><h1>{title}</h1><p className="lede">{description}</p></section>; }
async function checkAccess(setAccess: (value: AccessState) => void): Promise<void> { const response: Response = await fetch('/api/admin/mail-settings', { credentials: 'same-origin' }); if (response.ok) { setAccess('granted'); return; } if (response.status === 401) { setAccess('unauthenticated'); return; } setAccess('denied'); }
