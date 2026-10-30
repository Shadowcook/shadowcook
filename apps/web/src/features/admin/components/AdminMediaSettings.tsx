import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { ApiRequestError, jsonRequest, request } from '../../../lib/api/client';

interface MediaSettings {
  maxPublishedRecipeImages: number;
}

interface AdminMediaSettingsProperties {
  locale: Locale;
}

export default function AdminMediaSettings({ locale }: AdminMediaSettingsProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [limit, setLimit] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const helpId: string = useId();

  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    void request<MediaSettings>('/admin/media-settings', { signal: controller.signal })
      .then((settings: MediaSettings): void => {
        if (!controller.signal.aborted) setLimit(String(settings.maxPublishedRecipeImages));
      })
      .catch((): void => {
        if (!controller.signal.aborted) setError(text.errors.requestFailed);
      });
    return (): void => controller.abort();
  }, [text.errors.requestFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || limit === null) return;
    setMessage('');
    setError('');
    const maximum: number = Number(limit);
    if (
      !/^\d+$/.test(limit) ||
      !Number.isInteger(maximum) ||
      maximum < 0 ||
      maximum > 2_147_483_647
    ) {
      setError(text.adminMedia.invalidLimit);
      return;
    }
    setSaving(true);
    try {
      await request<void>('/admin/media-settings', {
        ...jsonRequest({ maxPublishedRecipeImages: maximum }),
        method: 'PUT',
      });
      setLimit(String(maximum));
      setMessage(text.adminMedia.saved);
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiRequestError && failure.code === 'INVALID_MEDIA_SETTINGS'
          ? text.adminMedia.invalidLimit
          : text.errors.requestFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-settings">
      <p className="eyebrow">{text.admin.settings}</p>
      <h1>{text.adminMedia.title}</h1>
      <p className="lede">{text.adminMedia.description}</p>
      {limit === null ? (
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
            {text.adminMedia.limit}
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              required
              value={limit}
              disabled={saving}
              aria-describedby={helpId}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setLimit(event.currentTarget.value)
              }
            />
          </label>
          <p id={helpId} className="hint">
            {text.adminMedia.limitHelp}
          </p>
          <p className="hint">{text.adminMedia.applyHelp}</p>
          <button type="submit" disabled={saving} aria-busy={saving}>
            {saving ? text.recipeEditor.saving : text.adminMedia.save}
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
