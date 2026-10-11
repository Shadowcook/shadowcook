import { useEffect, useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import StatusMessage from '../../../components/StatusMessage';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { jsonRequest, request } from '../../../lib/api/client';

interface BlockedTermsResponse {
  terms: string[];
}

export default function AdminCookbookSlugBlockedTerms({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  function load(): void {
    void request<BlockedTermsResponse>('/admin/cookbook-slug-blocked-terms')
      .then((response: BlockedTermsResponse): void => setTerms(response.terms))
      .catch((): void => setMessage(text.errors.requestFailed));
  }

  useEffect(load, [text.errors.requestFailed]);

  async function add(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    try {
      await request<void>('/admin/cookbook-slug-blocked-terms', {
        ...jsonRequest({ term }),
        method: 'POST',
      });
      setTerm('');
      setMessage(text.admin.cookbookSlugBlockedTermAdded);
      load();
    } catch (_error: unknown) {
      setMessage(text.admin.cookbookSlugBlockedTermInvalid);
    }
  }

  async function remove(value: string): Promise<void> {
    setMessage('');
    try {
      await request<void>(`/admin/cookbook-slug-blocked-terms/${encodeURIComponent(value)}`, {
        method: 'DELETE',
      });
      setMessage(text.admin.cookbookSlugBlockedTermRemoved);
      load();
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    }
  }

  return (
    <section className="admin-page">
      <p className="eyebrow">{text.admin.cookbookSlugBlockedTerms}</p>
      <h1>{text.admin.cookbookSlugBlockedTermsTitle}</h1>
      <p className="lede">{text.admin.cookbookSlugBlockedTermsDescription}</p>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void add(event)}>
        <label>
          {text.admin.cookbookSlugBlockedTerm}
          <input
            value={term}
            onChange={(event): void => setTerm(event.currentTarget.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={64}
            required
          />
        </label>
        <button type="submit">{text.admin.addCookbookSlugBlockedTerm}</button>
      </form>
      <ul className="admin-cookbook-slug-blocked-terms__list">
        {terms.map((value: string): JSX.Element => (
          <li className="admin-cookbook-slug-blocked-terms__item" key={value}>
            <button
              aria-label={text.admin.removeCookbookSlugBlockedTerm}
              className="admin-cookbook-slug-blocked-terms__remove"
              title={text.admin.removeCookbookSlugBlockedTerm}
              type="button"
              onClick={(): void => void remove(value)}
            >
              <AdminIcon name="delete" />
            </button>
            <code>{value}</code>
          </li>
        ))}
      </ul>
      <StatusMessage message={message} />
    </section>
  );
}
