import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';

interface TenantFormData {
  firstName: string;
  lastName: string;
  email: string;
  cookbookName: string;
  slug: string;
}
interface AdminTenantCreateProperties {
  locale: Locale;
  onCreated?: () => void;
  smtpConfigured?: boolean;
}
export default function AdminTenantCreate({
  locale,
  onCreated,
  smtpConfigured: suppliedSmtpConfigured,
}: AdminTenantCreateProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [data, setData] = useState<TenantFormData>({
    firstName: '',
    lastName: '',
    email: '',
    cookbookName: '',
    slug: '',
  });
  const [slugChanged, setSlugChanged] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [smtpConfigured, setSmtpConfigured] = useState<boolean>(suppliedSmtpConfigured ?? false);
  useEffect((): void => {
    if (suppliedSmtpConfigured !== undefined) {
      setSmtpConfigured(suppliedSmtpConfigured);
      return;
    }
    void loadSmtpConfiguration(setSmtpConfigured);
  }, [suppliedSmtpConfigured]);
  function update(name: keyof TenantFormData): (event: ChangeEvent<HTMLInputElement>) => void {
    return (event: ChangeEvent<HTMLInputElement>): void => {
      const value: string = event.currentTarget.value;
      if (name === 'cookbookName')
        setData({
          ...data,
          cookbookName: value,
          slug: slugChanged ? data.slug : slugFromCookbookName(value),
        });
      else {
        if (name === 'slug') setSlugChanged(true);
        setData({ ...data, [name]: value });
      }
    };
  }
  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch('/api/admin/tenants', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (response.ok) {
      if (onCreated === undefined) setMessage(text.admin.tenantCreated);
      else onCreated();
      return;
    }
    setMessage(await tenantCreationError(response, text));
  }
  return (
    <section className="admin-page">
      <p className="eyebrow">{text.admin.tenants}</p>
      <h1>{text.admin.tenantsNew}</h1>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
        <label>
          {text.admin.firstName}
          <input value={data.firstName} onChange={update('firstName')} required />
        </label>
        <label>
          {text.admin.lastName}
          <input value={data.lastName} onChange={update('lastName')} required />
        </label>
        <label>
          {text.login.emailLabel}
          <input value={data.email} onChange={update('email')} type="email" required />
        </label>
        <label>
          {text.admin.cookbookName}
          <input value={data.cookbookName} onChange={update('cookbookName')} required />
        </label>
        <label>
          {text.admin.tenantSlug}
          <input
            value={data.slug}
            onChange={update('slug')}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            aria-describedby="tenant-slug-hint"
          />
        </label>
        <p className="hint" id="tenant-slug-hint">
          {text.admin.tenantSlugHint}
        </p>
        <button
          type="submit"
          disabled={!smtpConfigured}
          aria-describedby={!smtpConfigured ? 'tenant-creation-smtp-required' : undefined}
        >
          {text.admin.createTenant}
        </button>
        {!smtpConfigured ? (
          <p className="hint" id="tenant-creation-smtp-required">
            {text.admin.tenantCreationSmtpRequired}
          </p>
        ) : null}
      </form>
      {message ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

async function loadSmtpConfiguration(setSmtpConfigured: (value: boolean) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/tenants', { credentials: 'same-origin' });
  if (!response.ok) return;
  const body = (await response.json()) as { smtpConfigured?: unknown };
  setSmtpConfigured(body.smtpConfigured === true);
}

async function tenantCreationError(response: Response, text: Translation): Promise<string> {
  const body = (await response.json().catch((): null => null)) as { code?: unknown } | null;
  if (body?.code === 'SMTP_REQUIRED' || body?.code === 'MAIL_NOT_CONFIGURED')
    return text.admin.tenantCreationSmtpRequired;
  if (body?.code === 'MAIL_DELIVERY_FAILED') return text.admin.tenantInvitationDeliveryFailed;
  return text.errors.requestFailed;
}

function slugFromCookbookName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
