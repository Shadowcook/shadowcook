import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { jsonRequest, request } from '../../../lib/api/client';

interface LegalDocuments {
  privacyStatementMarkdown: string;
  imprintMarkdown: string;
}

interface Properties {
  locale: Locale;
}

export default function AdminLegalDocuments({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [documents, setDocuments] = useState<LegalDocuments | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect((): void => {
    void request<LegalDocuments>('/admin/legal-documents')
      .then(setDocuments)
      .catch((): void => setMessage(text.errors.requestFailed));
  }, [text.errors.requestFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (documents === null) return;
    setIsSaving(true);
    setMessage('');
    try {
      await request<void>('/admin/legal-documents', { ...jsonRequest(documents), method: 'PUT' });
      setMessage(text.admin.legalDocumentsSaved);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (documents === null) return <p className="empty-state">{text.loading}</p>;
  return (
    <section className="admin-settings">
      <p className="eyebrow">{text.admin.settings}</p>
      <h1>{text.admin.legalDocumentsTitle}</h1>
      <p className="lede">{text.admin.legalDocumentsDescription}</p>
      <form
        className="admin-settings__form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}
      >
        <label>
          {text.buildFooter.privacyStatement}
          <textarea
            maxLength={50000}
            rows={16}
            value={documents.privacyStatementMarkdown}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setDocuments({ ...documents, privacyStatementMarkdown: event.currentTarget.value })
            }
          />
        </label>
        <label>
          {text.buildFooter.imprint}
          <textarea
            maxLength={50000}
            rows={16}
            value={documents.imprintMarkdown}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setDocuments({ ...documents, imprintMarkdown: event.currentTarget.value })
            }
          />
        </label>
        <button disabled={isSaving}>
          {isSaving ? text.recipeEditor.saving : text.admin.saveLegalDocuments}
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
