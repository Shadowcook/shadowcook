import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from '../lib/api/client';
import AccountProfileSettings from './AccountProfileSettings';
import AccountEmailSettings from './AccountEmailSettings';
import AccountCookbookSettings from './AccountCookbookSettings';
import AccountPasswordSettings from './AccountPasswordSettings';
import StatusMessage from './StatusMessage';

interface SettingsSection {
  path: string;
  label: string;
}

export default function AccountSettingsScreen({
  text,
  path,
}: {
  text: Translation;
  path: string;
}): JSX.Element {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean>(false);
  const section: string = path === '/settings' ? '/settings/profile' : path;
  const sections: SettingsSection[] = [
    { path: '/settings/profile', label: text.accountSettings.personalData },
    { path: '/settings/email', label: text.accountEmail.title },
    { path: '/settings/cookbooks', label: text.accountSettings.ownedCookbooks },
  ];

  useEffect((): void => {
    void request<{ hasPassword: boolean }>('/auth/session')
      .then((session: { hasPassword: boolean }): void => {
        setHasPassword(session.hasPassword);
        setAuthenticated(true);
      })
      .catch((): void => setAuthenticated(false));
  }, []);

  return (
    <section className="account-settings-area">
      <aside className="account-settings-navigation">
        <p className="eyebrow">{text.accountSettings.title}</p>
        <nav aria-label={text.accountSettings.title}>
          {sections.map((item: SettingsSection): JSX.Element => (
            <a
              key={item.path}
              href={item.path}
              className={
                section === item.path ||
                (section === '/settings/password' && item.path === '/settings/profile')
                  ? 'account-settings-navigation__link account-settings-navigation__link--active'
                  : 'account-settings-navigation__link'
              }
              aria-current={
                section === item.path ||
                (section === '/settings/password' && item.path === '/settings/profile')
                  ? 'page'
                  : undefined
              }
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="account-settings-content">
        <section className="panel auth-panel account-settings-panel">
          <h1>{text.accountSettings.title}</h1>
          <p className="lede">{text.accountSettings.subtitle}</p>
          {authenticated === null ? (
            <StatusMessage message={text.loading} />
          ) : authenticated === false ? (
            <StatusMessage message={text.accountSettings.signInRequired} />
          ) : section === '/settings/email' ? (
            <AccountEmailSettings text={text} />
          ) : section === '/settings/cookbooks' ? (
            <AccountCookbookSettings text={text} />
          ) : section === '/settings/password' ? (
            <AccountPasswordSettings
              text={text}
              hasPassword={hasPassword}
              onPasswordChanged={(): void => setHasPassword(true)}
            />
          ) : (
            <>
              <AccountProfileSettings text={text} />
              <div className="account-settings-panel__password-action">
                <a className="button-link" href="/settings/password">
                  {text.accountPassword.title}
                </a>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
