import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';

type LoginMode = 'PASSWORD_ONLY' | 'EMAIL_CODE_ONLY' | 'PASSWORD_OR_EMAIL_CODE';
export default function AdminAuthenticationSettings({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [mode, setMode] = useState<LoginMode>('PASSWORD_OR_EMAIL_CODE');
  const [message, setMessage] = useState<string>('');
  useEffect((): void => {
    void fetch('/api/admin/authentication-settings', { credentials: 'same-origin' }).then(
      async (response: Response): Promise<void> => {
        if (response.ok) {
          const data = (await response.json()) as { loginMode: LoginMode };
          setMode(data.loginMode);
        }
      },
    );
  }, []);
  async function save(): Promise<void> {
    const response = await fetch('/api/admin/authentication-settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginMode: mode }),
    });
    setMessage(response.ok ? text.admin.saveAuthentication : text.errors.smtpRequired);
  }
  return (
    <section className="admin-page">
      <p className="eyebrow">{text.admin.authentication}</p>
      <h1>{text.admin.authenticationTitle}</h1>
      <p className="lede">{text.admin.authenticationDescription}</p>
      <label>
        {text.admin.authentication}
        <select
          value={mode}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setMode(event.currentTarget.value as LoginMode)
          }
        >
          <option value="PASSWORD_ONLY">{text.admin.passwordOnly}</option>
          <option value="EMAIL_CODE_ONLY">{text.admin.emailCodeOnly}</option>
          <option value="PASSWORD_OR_EMAIL_CODE">{text.admin.passwordOrEmailCode}</option>
        </select>
      </label>
      <button type="button" onClick={() => void save()}>
        {text.admin.saveAuthentication}
      </button>
      {message ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
