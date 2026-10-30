import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import PasswordField from '../../../components/PasswordField';

interface Properties {
  locale: Locale;
}
interface SettingsResponse {
  configured: boolean;
  host?: string;
  port?: number;
  transportSecurity?: 'STARTTLS' | 'IMPLICIT_TLS';
  username?: string | null;
  fromEmail?: string;
  fromName?: string;
}
interface FormValues {
  host: string;
  port: string;
  transportSecurity: 'STARTTLS' | 'IMPLICIT_TLS';
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  recipient: string;
}

const emptyValues: FormValues = {
  host: '',
  port: '587',
  transportSecurity: 'STARTTLS',
  username: '',
  password: '',
  fromEmail: '',
  fromName: 'Shadowcook',
  recipient: '',
};

export default function AdminMailSettings({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);

  useEffect((): void => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const settings: SettingsResponse = await request<SettingsResponse>('/admin/mail-settings');
      if (!settings.configured) {
        setMessage(text.adminMail.notConfigured);
        return;
      }
      setValues((current: FormValues): FormValues => ({
        ...current,
        host: settings.host ?? '',
        port: String(settings.port ?? 587),
        transportSecurity: settings.transportSecurity ?? 'STARTTLS',
        username: settings.username ?? '',
        fromEmail: settings.fromEmail ?? '',
        fromName: settings.fromName ?? 'Shadowcook',
      }));
    } catch (requestError: unknown) {
      setError(messageFor(requestError, text));
    } finally {
      setLoading(false);
    }
  }

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        host: values.host,
        port: Number(values.port),
        transportSecurity: values.transportSecurity,
        username: values.username.length === 0 ? null : values.username,
        fromEmail: values.fromEmail,
        fromName: values.fromName,
      };
      if (values.password.length > 0) body.password = values.password;
      await request<void>('/admin/mail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setValues((current: FormValues): FormValues => ({ ...current, password: '' }));
      setMessage(text.adminMail.saved);
    } catch (requestError: unknown) {
      setError(messageFor(requestError, text));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(): Promise<void> {
    setSending(true);
    setError('');
    setMessage('');
    try {
      await request<void>('/admin/mail-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: values.recipient }),
      });
      setMessage(text.adminMail.testSent);
    } catch (requestError: unknown) {
      setError(messageFor(requestError, text));
    } finally {
      setSending(false);
    }
  }

  function update(
    field: keyof FormValues,
  ): (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void =>
      setValues((current: FormValues): FormValues => ({ ...current, [field]: event.target.value }));
  }
  if (loading)
    return (
      <section className="panel loading-panel" aria-live="polite">
        {text.loading}
      </section>
    );
  if (error === text.adminMail.signInRequired || error === text.adminMail.accessDenied)
    return (
      <section className="panel">
        <h1>{text.adminMail.title}</h1>
        <p className="message" role="alert">
          {error}
        </p>
      </section>
    );
  return (
    <section className="admin-settings">
      <header>
        <p className="eyebrow">{text.admin.title}</p>
        <h1>{text.adminMail.title}</h1>
        <p className="lede">{text.adminMail.subtitle}</p>
      </header>
      <form onSubmit={save} className="admin-settings__form">
        <label>
          {text.adminMail.host}
          <input value={values.host} onChange={update('host')} required autoComplete="off" />
        </label>
        <label>
          {text.adminMail.port}
          <input
            value={values.port}
            onChange={update('port')}
            type="number"
            min="1"
            max="65535"
            required
          />
        </label>
        <label>
          {text.adminMail.security}
          <select value={values.transportSecurity} onChange={update('transportSecurity')}>
            <option value="STARTTLS">{text.adminMail.startTls}</option>
            <option value="IMPLICIT_TLS">{text.adminMail.implicitTls}</option>
          </select>
        </label>
        <label>
          {text.adminMail.username}
          <input value={values.username} onChange={update('username')} autoComplete="username" />
        </label>
        <PasswordField
          text={text}
          label={text.adminMail.password}
          value={values.password}
          onChange={update('password')}
          autoComplete="new-password"
          hint={text.adminMail.passwordHint}
        />
        <label>
          {text.adminMail.fromEmail}
          <input value={values.fromEmail} onChange={update('fromEmail')} type="email" required />
        </label>
        <label>
          {text.adminMail.fromName}
          <input value={values.fromName} onChange={update('fromName')} required />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? text.adminMail.saving : text.adminMail.save}
        </button>
      </form>
      <section className="admin-settings__test">
        <h2>{text.adminMail.sendTest}</h2>
        <label>
          {text.adminMail.testRecipient}
          <input value={values.recipient} onChange={update('recipient')} type="email" required />
        </label>
        <button
          type="button"
          disabled={sending || values.recipient.length === 0}
          onClick={() => void sendTest()}
        >
          {sending ? text.adminMail.sendingTest : text.adminMail.sendTest}
        </button>
      </section>
      {message.length > 0 ? (
        <p className="hint" role="status">
          {message}
        </p>
      ) : null}
      {error.length > 0 ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response: Response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const error: unknown = await response.json().catch((): null => null);
    throw error;
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
function messageFor(error: unknown, text: Translation): string {
  if (isRecord(error)) {
    const code: unknown = error.code;
    if (code === 'AUTHENTICATION_REQUIRED') return text.adminMail.signInRequired;
    if (code === 'INSTANCE_PERMISSION_REQUIRED') return text.adminMail.accessDenied;
    if (typeof error.error === 'string') return error.error;
  }
  return text.errors.requestFailed;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
