import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { jsonRequest, request } from '../../../lib/api/client';
import StatusMessage from '../../../components/StatusMessage';

export default function AdminRegistrationSettings({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [enabled, setEnabled] = useState<boolean>(true);
  const [turnstileEnabled, setTurnstileEnabled] = useState<boolean>(false);
  const [turnstileConfigured, setTurnstileConfigured] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  useEffect((): void => {
    void request<{
      enabled: boolean;
      turnstileEnabled: boolean;
      turnstileConfigured: boolean;
    }>('/admin/registration-settings')
      .then(
        (settings: {
          enabled: boolean;
          turnstileEnabled: boolean;
          turnstileConfigured: boolean;
        }): void => {
          setEnabled(settings.enabled);
          setTurnstileEnabled(settings.turnstileEnabled);
          setTurnstileConfigured(settings.turnstileConfigured);
        },
      )
      .catch((): void => setMessage(text.errors.requestFailed));
  }, [text.errors.requestFailed]);
  async function save(): Promise<void> {
    setSaving(true);
    setMessage('');
    try {
      await request<void>('/admin/registration-settings', {
        ...jsonRequest({ enabled, turnstileEnabled }),
        method: 'PUT',
      });
      setMessage(text.admin.registrationSaved);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="admin-page">
      <p className="eyebrow">{text.admin.registration}</p>
      <h1>{text.admin.registrationTitle}</h1>
      <p className="lede">{text.admin.registrationDescription}</p>
      <label className="admin-registration-settings__option">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event): void => setEnabled(event.currentTarget.checked)}
        />{' '}
        {text.admin.registrationEnabled}
      </label>
      <label className="admin-registration-settings__option">
        <input
          type="checkbox"
          checked={turnstileEnabled}
          disabled={!turnstileConfigured}
          onChange={(event): void => setTurnstileEnabled(event.currentTarget.checked)}
        />{' '}
        {text.admin.turnstileEnabled}
      </label>
      {!turnstileConfigured ? <p className="hint">{text.admin.turnstileNotConfigured}</p> : null}
      <button
        className="admin-registration-settings__save"
        type="button"
        disabled={saving}
        onClick={(): void => void save()}
      >
        {saving ? text.admin.savingRegistration : text.admin.saveRegistration}
      </button>
      <StatusMessage message={message} />
    </section>
  );
}
