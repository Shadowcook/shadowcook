import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { ApiRequestError, jsonRequest, request } from '../../../lib/api/client';

interface AuditSettings {
  retentionDays: number;
}

interface AdminAuditSettingsProperties {
  locale: Locale;
}

export default function AdminAuditSettings({ locale }: AdminAuditSettingsProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [retentionDays, setRetentionDays] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const helpId: string = useId();

  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    void request<AuditSettings>('/admin/audit-settings', { signal: controller.signal })
      .then((settings: AuditSettings): void => {
        if (!controller.signal.aborted) setRetentionDays(String(settings.retentionDays));
      })
      .catch((): void => {
        if (!controller.signal.aborted) setError(text.errors.requestFailed);
      });
    return (): void => controller.abort();
  }, [text.errors.requestFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || retentionDays === null) return;
    setMessage('');
    setError('');
    const days: number = Number(retentionDays);
    if (!/^\d+$/.test(retentionDays) || !Number.isInteger(days) || days < 1 || days > 3650) {
      setError(text.adminAudit.invalidLimit);
      return;
    }
    setSaving(true);
    try {
      await request<void>('/admin/audit-settings', {
        ...jsonRequest({ retentionDays: days }),
        method: 'PUT',
      });
      setRetentionDays(String(days));
      setMessage(text.adminAudit.saved);
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiRequestError && failure.code === 'INVALID_AUDIT_SETTINGS'
          ? text.adminAudit.invalidLimit
          : text.errors.requestFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-settings">
      <p className="eyebrow">{text.admin.settings}</p>
      <h1>{text.adminAudit.title}</h1>
      <p className="lede">{text.adminAudit.description}</p>
      {retentionDays === null ? (
        error ? null : (
          <p className="empty-state">{text.loading}</p>
        )
      ) : (
        <form
          className="admin-settings__form"
          noValidate
          onSubmit={(event: SubmitEvent<HTMLFormElement>): void => {
            void save(event);
          }}
        >
          <label>
            {text.adminAudit.limit}
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              required
              value={retentionDays}
              disabled={saving}
              aria-describedby={helpId}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setRetentionDays(event.currentTarget.value)
              }
            />
          </label>
          <p id={helpId} className="hint">
            {text.adminAudit.limitHelp}
          </p>
          <p className="hint">{text.adminAudit.applyHelp}</p>
          <button type="submit" disabled={saving} aria-busy={saving}>
            {saving ? text.recipeEditor.saving : text.adminAudit.save}
          </button>
        </form>
      )}
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
