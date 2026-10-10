import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { ApiRequestError, request } from '../../../lib/api/client';

interface Properties {
  locale: Locale;
}
interface EmailTemplate {
  key: string;
  subject: string;
  body: string;
  placeholders: string[];
  customized: boolean;
}
interface ResponseBody {
  templates: EmailTemplate[];
}

export default function AdminEmailTemplates({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const selected: EmailTemplate | undefined = templates.find(
    (template: EmailTemplate): boolean => template.key === selectedKey,
  );
  useEffect((): void => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const response: ResponseBody = await request<ResponseBody>('/admin/email-templates');
      setTemplates(response.templates);
      select(
        response.templates.find(
          (template: EmailTemplate): boolean => template.key === selectedKey,
        ) ?? response.templates[0],
      );
    } catch (requestError: unknown) {
      setError(errorMessage(requestError, text));
    } finally {
      setLoading(false);
    }
  }
  function select(template: EmailTemplate | undefined): void {
    if (template === undefined) return;
    setSelectedKey(template.key);
    setSubject(template.subject);
    setBody(template.body);
  }
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selected === undefined) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await request<void>(`/admin/email-templates/${encodeURIComponent(selected.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      await load();
      setMessage(text.emailTemplates.saved);
    } catch (requestError: unknown) {
      setError(errorMessage(requestError, text));
    } finally {
      setSaving(false);
    }
  }
  async function restoreDefault(): Promise<void> {
    if (selected === undefined) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await request<void>(`/admin/email-templates/${encodeURIComponent(selected.key)}`, {
        method: 'DELETE',
      });
      await load();
      setMessage(text.emailTemplates.restored);
    } catch (requestError: unknown) {
      setError(errorMessage(requestError, text));
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <section className="panel loading-panel" aria-live="polite">
        {text.loading}
      </section>
    );
  if (error === text.emailTemplates.signInRequired || error === text.emailTemplates.accessDenied)
    return (
      <section className="panel">
        <h1>{text.emailTemplates.title}</h1>
        <p className="message" role="alert">
          {error}
        </p>
      </section>
    );
  return (
    <section className="admin-settings">
      <header>
        <p className="eyebrow">{text.admin.title}</p>
        <h1>{text.emailTemplates.title}</h1>
        <p className="lede">{text.emailTemplates.subtitle}</p>
      </header>
      <form onSubmit={save} className="admin-settings__form">
        <label>
          {text.emailTemplates.selectTemplate}
          <select
            value={selectedKey}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              select(
                templates.find(
                  (template: EmailTemplate): boolean => template.key === event.currentTarget.value,
                ),
              )
            }
          >
            {templates.map((template: EmailTemplate): JSX.Element => (
              <option key={template.key} value={template.key}>
                {text.emailTemplates.templateNames[template.key] ?? template.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text.emailTemplates.subject}
          <input
            value={subject}
            maxLength={300}
            required
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setSubject(event.currentTarget.value)
            }
          />
        </label>
        <label>
          {text.emailTemplates.body}
          <textarea
            value={body}
            rows={10}
            maxLength={20000}
            required
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setBody(event.currentTarget.value)
            }
          />
        </label>
        <p>
          <strong>{text.emailTemplates.placeholders}:</strong>{' '}
          {selected?.placeholders
            .map((placeholder: string): string => `{{${placeholder}}}`)
            .join(', ')}
        </p>
        <button type="submit" disabled={saving}>
          {saving ? text.emailTemplates.saving : text.emailTemplates.save}
        </button>
        <button
          type="button"
          disabled={saving || selected?.customized !== true}
          onClick={restoreDefault}
        >
          {text.emailTemplates.restoreDefault}
        </button>
      </form>
      {message.length === 0 ? null : (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {error.length === 0 ? null : (
        <p className="message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function errorMessage(error: unknown, text: Translation): string {
  if (!(error instanceof ApiRequestError)) return text.errors.requestFailed;
  if (error.code === 'AUTHENTICATION_REQUIRED') return text.emailTemplates.signInRequired;
  if (error.code === 'INSTANCE_PERMISSION_REQUIRED') return text.emailTemplates.accessDenied;
  return text.errors[error.code as keyof Translation['errors']] ?? text.errors.requestFailed;
}
