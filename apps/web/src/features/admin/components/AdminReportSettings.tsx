import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations, type Locale, type Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import { reportError } from '../../reports/errors';

export default function AdminReportSettings({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  useEffect((): (() => void) => {
    let active: boolean = true;
    void request<{ recipientEmail: string | null }>('/admin/report-settings')
      .then((settings: { recipientEmail: string | null }): void => {
        if (active) setEmail(settings.recipientEmail ?? '');
      })
      .catch((failure: unknown): void => {
        if (active) setError(reportError(failure, text));
      })
      .finally((): void => {
        if (active) setLoading(false);
      });
    return (): void => {
      active = false;
    };
  }, [text]);
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await request<void>('/admin/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: email.trim() || null }),
      });
      setSaved(true);
    } catch (failure: unknown) {
      setError(reportError(failure, text));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-settings">
      <h1>{text.reports.settings}</h1>
      <p>{text.reports.recipientHint}</p>
      {loading ? (
        <p aria-live="polite">{text.loading}</p>
      ) : (
        <form className="admin-settings__form" onSubmit={save}>
          <label>
            {text.reports.recipientEmail}
            <input
              type="email"
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setEmail(event.currentTarget.value)
              }
            />
          </label>
          <p className="hint">{text.reports.notificationHint}</p>
          <button disabled={busy}>{text.reports.save}</button>
        </form>
      )}
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">{text.reports.saved}</p> : null}
    </section>
  );
}
