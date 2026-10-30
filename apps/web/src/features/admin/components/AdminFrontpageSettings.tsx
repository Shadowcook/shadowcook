import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Locale, Translation } from '../../../i18n';
import { translations } from '../../../i18n';
import { jsonRequest, request } from '../../../lib/api/client';

interface FrontpageSettings {
  siteName: string;
  slogan: string;
  cookbooksPerPage: number;
}

interface Properties {
  locale: Locale;
}

export default function AdminFrontpageSettings({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [settings, setSettings] = useState<FrontpageSettings | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect((): void => {
    void request<FrontpageSettings>('/admin/frontpage-settings')
      .then(setSettings)
      .catch((): void => setMessage(text.errors.requestFailed));
  }, [text.errors.requestFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (settings === null) return;
    setIsSaving(true);
    setMessage('');
    try {
      await request<void>('/admin/frontpage-settings', { ...jsonRequest(settings), method: 'PUT' });
      setMessage(text.admin.frontpageSaved);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (settings === null) return <p className="empty-state">{text.loading}</p>;
  return (
    <section className="admin-settings">
      <p className="eyebrow">{text.admin.settings}</p>
      <h1>{text.admin.frontpageTitle}</h1>
      <p className="lede">{text.admin.frontpageDescription}</p>
      <form
        className="admin-settings__form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}
      >
        <label>
          {text.admin.siteName}
          <input
            type="text"
            maxLength={80}
            required
            value={settings.siteName}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setSettings({ ...settings, siteName: event.currentTarget.value })
            }
          />
        </label>
        <label>
          {text.admin.siteSlogan}
          <input
            type="text"
            maxLength={80}
            required
            value={settings.slogan}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setSettings({ ...settings, slogan: event.currentTarget.value })
            }
          />
        </label>
        <label>
          {text.admin.cookbooksPerPage}
          <input
            type="number"
            min={1}
            max={100}
            required
            value={settings.cookbooksPerPage}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setSettings({ ...settings, cookbooksPerPage: Number(event.currentTarget.value) })
            }
          />
        </label>
        <button disabled={isSaving}>
          {isSaving ? text.recipeEditor.saving : text.admin.saveFrontpage}
        </button>
      </form>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
