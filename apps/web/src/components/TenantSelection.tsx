import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import type { CookbookTenant } from './cookbook-types';

interface TenantSelectionProperties {
  locale: Locale;
}

export default function TenantSelection({ locale }: TenantSelectionProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [tenants, setTenants] = useState<CookbookTenant[]>([]);
  useEffect((): void => {
    void loadTenants(setTenants);
  }, []);
  return (
    <section className="dashboard">
      <p className="eyebrow">{text.dashboard.cookbook}</p>
      <h1>{text.dashboard.chooseTenant}</h1>
      <p className="lede">{text.dashboard.chooseTenantDescription}</p>
      <div className="recipe-grid">
        {tenants.map((tenant: CookbookTenant): JSX.Element => (
          <article className="recipe-card" key={tenant.public_id}>
            <a className="recipe-card__button" href={`/${tenant.slug}`}>
              <h2>{tenant.display_name}</h2>
              <p>{tenant.description ?? ''}</p>
              <div className="recipe-card__categories">
                <span>
                  {tenant.recipe_count} {text.dashboard.recipesCount}
                </span>
              </div>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

async function loadTenants(setTenants: (tenants: CookbookTenant[]) => void): Promise<void> {
  const response: Response = await fetch('/api/cookbook/tenants', { credentials: 'same-origin' });
  if (response.ok) setTenants(((await response.json()) as { tenants: CookbookTenant[] }).tenants);
}
