import { useEffect, useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { jsonRequest, request } from '../lib/api/client';
import StatusMessage from './StatusMessage';
import CookbookUrlPreview from './CookbookUrlPreview';

export default function AccountSettingsScreen({ text }: { text: Translation }): JSX.Element {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cookbookName, setCookbookName] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [cookbooks, setCookbooks] = useState<OwnedCookbook[]>([]);
  const [maximumCookbooks, setMaximumCookbooks] = useState<number>(1);

  useEffect((): void => {
    void request('/auth/session')
      .then(async (): Promise<void> => {
        setAuthenticated(true);
        const result: {
          cookbooks: OwnedCookbook[];
          maxCookbooksPerOwner: number;
        } = await request('/account/cookbooks');
        setCookbooks(result.cookbooks);
        setMaximumCookbooks(result.maxCookbooksPerOwner);
      })
      .catch((): void => setAuthenticated(false));
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const result: { tenantSlug: string } = await request(
        '/account/cookbooks',
        jsonRequest({ cookbookName }),
      );
      window.location.assign(`/${encodeURIComponent(result.tenantSlug)}`);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
      setSubmitting(false);
    }
  }

  return (
    <section className="panel auth-panel account-settings-panel">
      <p className="eyebrow">{text.accountSettings.title}</p>
      <h1>{text.accountSettings.title}</h1>
      <p className="lede">{text.accountSettings.subtitle}</p>
      {authenticated === false ? (
        <StatusMessage message={text.accountSettings.signInRequired} />
      ) : authenticated === true ? (
        <>
          <h2>{text.accountSettings.ownedCookbooks}</h2>
          <div className="user-table-container">
            <table className="tenant-table account-settings-panel__cookbook-table">
              <thead>
                <tr>
                  <th>{text.dashboard.tenantName}</th>
                  <th>{text.accountSettings.cookbookRecipes}</th>
                  <th>{text.accountSettings.cookbookUsers}</th>
                  <th>{text.accountSettings.cookbookStartPage}</th>
                </tr>
              </thead>
              <tbody>
                {cookbooks.map((cookbook: OwnedCookbook): JSX.Element => (
                  <tr key={cookbook.slug}>
                    <td>
                      <a href={`/${encodeURIComponent(cookbook.slug)}`}>{cookbook.name}</a>
                    </td>
                    <td>{cookbook.recipeCount}</td>
                    <td>{cookbook.userCount}</td>
                    <td>
                      {cookbook.showOnStartPage
                        ? text.accountSettings.yes
                        : text.accountSettings.no}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cookbooks.length >= maximumCookbooks ? (
            <StatusMessage message={text.accountSettings.cookbookLimitReached} />
          ) : (
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
              <label>
                {text.accountSettings.cookbookName}
                <input
                  type="text"
                  minLength={3}
                  maxLength={120}
                  required
                  value={cookbookName}
                  onChange={(event): void => setCookbookName(event.currentTarget.value)}
                />
                <CookbookUrlPreview cookbookName={cookbookName} text={text} />
              </label>
              <button type="submit" disabled={submitting}>
                {submitting
                  ? text.accountSettings.creatingCookbook
                  : text.accountSettings.createCookbook}
              </button>
            </form>
          )}
        </>
      ) : null}
      <StatusMessage message={message} />
    </section>
  );
}

interface OwnedCookbook {
  name: string;
  slug: string;
  recipeCount: number;
  userCount: number;
  showOnStartPage: boolean;
}
