import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Translation } from '../i18n';
import { jsonRequest, request } from '../lib/api/client';
import CreateCookbookModal from './CreateCookbookModal';
import StatusMessage from './StatusMessage';

export default function AccountSettingsScreen({ text }: { text: Translation }): JSX.Element {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isCreateCookbookModalOpen, setIsCreateCookbookModalOpen] = useState<boolean>(false);
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

  async function createCookbook(cookbookName: string): Promise<void> {
    setSubmitting(true);
    setMessage('');
    try {
      const result: { tenantSlug: string } = await request(
        '/account/cookbooks',
        jsonRequest({ cookbookName }),
      );
      window.location.assign(`/${encodeURIComponent(result.tenantSlug)}`);
    } catch (error: unknown) {
      setSubmitting(false);
      throw error;
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
          <div className="account-settings-panel__cookbook-heading">
            <div>
              <h2>{text.accountSettings.ownedCookbooks}</h2>
              <p className="account-settings-panel__cookbook-count">
                {text.accountSettings.cookbookCount
                  .replace('{count}', String(cookbooks.length))
                  .replace('{maximum}', String(maximumCookbooks))}
              </p>
            </div>
            {cookbooks.length < maximumCookbooks ? (
              <button
                type="button"
                className="account-settings-panel__add-cookbook"
                onClick={(): void => setIsCreateCookbookModalOpen(true)}
              >
                <FontAwesomeIcon aria-hidden="true" icon={faPlus} />
                <span>{text.accountSettings.addCookbook}</span>
              </button>
            ) : null}
          </div>
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
                {cookbooks.length === 0 ? (
                  <tr>
                    <td className="account-settings-panel__empty-table" colSpan={4}>
                      {text.accountSettings.noOwnedCookbooks}
                    </td>
                  </tr>
                ) : (
                  cookbooks.map((cookbook: OwnedCookbook): JSX.Element => (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
          {cookbooks.length >= maximumCookbooks ? (
            <StatusMessage message={text.accountSettings.cookbookLimitReached} />
          ) : null}
          {isCreateCookbookModalOpen ? (
            <CreateCookbookModal
              text={text}
              submitting={submitting}
              onSubmit={createCookbook}
              onClose={(): void => setIsCreateCookbookModalOpen(false)}
            />
          ) : null}
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
