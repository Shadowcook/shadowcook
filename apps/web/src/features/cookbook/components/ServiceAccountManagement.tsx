import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';

interface TenantRole {
  id: string;
  name: string;
}
interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  revokedAt: string | null;
}
interface ServiceAccount {
  public_id: string;
  name: string;
  disabled_at: string | null;
  roles: TenantRole[];
  tokens: ApiToken[];
}
interface ServiceAccountResponse {
  serviceAccounts: ServiceAccount[];
  roles: TenantRole[];
}

export default function ServiceAccountManagement({
  locale,
  tenantSlug,
}: {
  locale: Locale;
  tenantSlug: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [name, setName] = useState<string>('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [tokenAccount, setTokenAccount] = useState<ServiceAccount | null>(null);
  const [tokenName, setTokenName] = useState<string>('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  function endpoint(path: string = ''): string {
    return `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/service-accounts${path}`;
  }
  function refresh(): void {
    void load(endpoint(), setAccounts, setRoles);
  }
  useEffect(refresh, [tenantSlug]);
  function toggleRole(roleId: string): void {
    setRoleIds((current: string[]): string[] =>
      current.includes(roleId)
        ? current.filter((id: string): boolean => id !== roleId)
        : [...current, roleId],
    );
  }
  async function createAccount(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(endpoint(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, roleIds }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setName('');
    setRoleIds([]);
    setMessage(text.serviceAccounts.created);
    refresh();
  }
  async function createToken(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (tokenAccount === null) return;
    const response: Response = await fetch(endpoint(`/${tokenAccount.public_id}/tokens`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tokenName }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    const payload: { token: string } = (await response.json()) as { token: string };
    setCreatedToken(payload.token);
    setTokenName('');
    refresh();
  }
  async function revokeToken(account: ServiceAccount, token: ApiToken): Promise<void> {
    const response: Response = await fetch(endpoint(`/${account.public_id}/tokens/${token.id}`), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    refresh();
  }
  async function disableAccount(account: ServiceAccount): Promise<void> {
    const response: Response = await fetch(endpoint(`/${account.public_id}`), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setMessage(response.ok ? text.serviceAccounts.deleted : text.errors.requestFailed);
    if (response.ok) refresh();
  }
  return (
    <section className="admin-page admin-page--wide admin-page--users">
      <p className="eyebrow">{text.tenantNavigation.serviceAccounts}</p>
      <h1>{text.serviceAccounts.title}</h1>
      <p className="lede">{text.serviceAccounts.description}</p>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void createAccount(event)}>
        <label>
          {text.serviceAccounts.name}
          <input
            required
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setName(event.currentTarget.value)
            }
          />
        </label>
        <fieldset>
          <legend>{text.serviceAccounts.roles}</legend>
          {roles.map((role: TenantRole): JSX.Element => (
            <label className="role-assignment__option" key={role.id}>
              <input
                type="checkbox"
                checked={roleIds.includes(role.id)}
                onChange={(): void => toggleRole(role.id)}
              />
              <span>{role.name}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={roleIds.length === 0}>
          {text.serviceAccounts.create}
        </button>
      </form>
      <div className="user-table-container">
        <table className="tenant-table user-table">
          <thead>
            <tr>
              <th>{text.serviceAccounts.name}</th>
              <th>{text.serviceAccounts.roles}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account: ServiceAccount): JSX.Element => (
              <tr key={account.public_id}>
                <td>
                  {account.name}
                  {account.disabled_at === null ? null : ` (${text.serviceAccounts.disabled})`}
                </td>
                <td>{account.roles.map((role: TenantRole): string => role.name).join(', ')}</td>
                <td>
                  {account.disabled_at === null ? (
                    <>
                      <button
                        type="button"
                        onClick={(): void => {
                          setTokenAccount(account);
                          setCreatedToken(null);
                        }}
                      >
                        {text.serviceAccounts.createToken}
                      </button>
                      <button
                        type="button"
                        className="button--secondary"
                        onClick={(): void => void disableAccount(account)}
                      >
                        {text.serviceAccounts.disabled}
                      </button>
                    </>
                  ) : null}
                  <ul>
                    {account.tokens
                      .filter((token: ApiToken): boolean => token.revokedAt === null)
                      .map((token: ApiToken): JSX.Element => (
                        <li key={token.id}>
                          {token.name} ({token.tokenPrefix}…){' '}
                          <button
                            type="button"
                            className="button--secondary"
                            onClick={(): void => void revokeToken(account, token)}
                          >
                            {text.serviceAccounts.revokeToken}
                          </button>
                        </li>
                      ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tokenAccount === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="service-account-token-title">
            <h2 id="service-account-token-title">{text.serviceAccounts.createToken}</h2>
            {createdToken === null ? (
              <form
                onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void createToken(event)}
              >
                <label>
                  {text.serviceAccounts.tokenName}
                  <input
                    autoFocus
                    required
                    value={tokenName}
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      setTokenName(event.currentTarget.value)
                    }
                  />
                </label>
                <button type="submit">{text.serviceAccounts.createToken}</button>
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => setTokenAccount(null)}
                >
                  {text.admin.cancel}
                </button>
              </form>
            ) : (
              <>
                <p>
                  {text.serviceAccounts.tokenCreated} {text.serviceAccounts.tokenWarning}
                </p>
                <textarea
                  readOnly
                  value={createdToken}
                  aria-label={text.serviceAccounts.createToken}
                />
                <button type="button" onClick={(): void => setTokenAccount(null)}>
                  {text.admin.cancel}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

async function load(
  endpoint: string,
  setAccounts: (accounts: ServiceAccount[]) => void,
  setRoles: (roles: TenantRole[]) => void,
): Promise<void> {
  const response: Response = await fetch(endpoint, { credentials: 'same-origin' });
  if (!response.ok) return;
  const payload: ServiceAccountResponse = (await response.json()) as ServiceAccountResponse;
  setAccounts(payload.serviceAccounts);
  setRoles(payload.roles);
}
