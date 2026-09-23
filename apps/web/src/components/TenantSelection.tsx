import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import AdminTenantCreate from './AdminTenantCreate';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import type { CookbookTenant } from './cookbook-types';

export default function TenantSelection({ locale, management = false }: { locale: Locale; management?: boolean }): JSX.Element {
  const text: Translation = translations[locale];
  const [tenants, setTenants] = useState<CookbookTenant[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [renameTenant, setRenameTenant] = useState<CookbookTenant | null>(null);
  const [deleteTenant, setDeleteTenant] = useState<CookbookTenant | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  function refresh(): void { void loadTenants(setTenants, management); }
  function openRename(tenant: CookbookTenant): void { setRenameTenant(tenant); setDisplayName(tenant.display_name); setMessage(''); }
  function closeRename(): void { setRenameTenant(null); setDisplayName(''); }
  function closeDelete(): void { setDeleteTenant(null); }
  async function rename(event: SubmitEvent<HTMLFormElement>): Promise<void> { event.preventDefault(); if (renameTenant === null) return; const response: Response = await updateTenant(renameTenant.public_id, { displayName }); if (!response.ok) { setMessage(text.errors.requestFailed); return; } closeRename(); setMessage(text.admin.tenantRenamed); refresh(); }
  async function remove(): Promise<void> { if (deleteTenant === null) return; const response: Response = await fetch(`/api/admin/tenants/${deleteTenant.public_id}`, { method: 'DELETE', credentials: 'same-origin' }); if (!response.ok) { setMessage(text.errors.requestFailed); return; } closeDelete(); setMessage(text.admin.tenantDeleted); refresh(); }
  const visible: CookbookTenant[] = tenants.filter((tenant: CookbookTenant): boolean => `${tenant.display_name} ${tenant.description ?? ''}`.toLowerCase().includes(filter.toLowerCase()));

  useEffect(refresh, [management]);

  if (!management) return <section className="dashboard"><p className="eyebrow">{text.dashboard.cookbook}</p><h1>{text.dashboard.chooseTenant}</h1><p className="lede">{text.dashboard.chooseTenantDescription}</p><div className="recipe-grid">{visible.map((tenant: CookbookTenant): JSX.Element => <article className="recipe-card" key={tenant.public_id}><a className="recipe-card__button" href={`/${tenant.slug}`}><h2>{tenant.display_name}</h2><p>{tenant.description ?? ''}</p><div className="recipe-card__categories"><span>{tenant.recipe_count} {text.dashboard.recipesCount}</span></div></a></article>)}</div></section>;
  return <section className="admin-page admin-page--wide"><div className="dashboard__header"><h1>{text.admin.tenantsTitle}</h1><button onClick={(): void => setShowCreate(true)}>{text.admin.createTenant}</button></div><label>{text.dashboard.filterTenants}<input value={filter} onChange={(event: ChangeEvent<HTMLInputElement>): void => setFilter(event.currentTarget.value)} type="search" /></label>{message.length > 0 ? <p className="message" role="status">{message}</p> : null}<table className="tenant-table"><thead><tr><th>{text.dashboard.tenantName}</th><th>{text.dashboard.tenantDescription}</th><th>{text.dashboard.tenantOwner}</th><th>{text.dashboard.recipes}</th><th>{text.dashboard.actions}</th></tr></thead><tbody>{visible.map((tenant: CookbookTenant): JSX.Element => <tr key={tenant.public_id}><td>{tenant.display_name}</td><td className="tenant-description" title={tenant.description ?? ''}>{tenant.description ?? ''}</td><td>{tenant.owner_name ?? ''}</td><td>{tenant.recipe_count}</td><td><div className="tenant-actions"><button aria-label={tenant.disabled_at === null ? text.dashboard.disable : text.dashboard.enable} title={tenant.disabled_at === null ? text.dashboard.disable : text.dashboard.enable} onClick={(): void => void toggleDisabled(tenant, refresh)}>{tenant.disabled_at === null ? '⏸' : '▶'}</button><button aria-label={text.dashboard.rename} title={text.dashboard.rename} onClick={(): void => openRename(tenant)}>✎</button><button aria-label={text.dashboard.delete} title={text.dashboard.delete} onClick={(): void => { setDeleteTenant(tenant); setMessage(''); }}>⌫</button></div></td></tr>)}</tbody></table>{showCreate ? <div className="modal-backdrop"><section className="modal"><button onClick={(): void => setShowCreate(false)}>{text.dashboard.close}</button><AdminTenantCreate locale={locale} /></section></div> : null}{renameTenant === null ? null : <div className="modal-backdrop"><section className="modal" aria-labelledby="rename-tenant-title"><h2 id="rename-tenant-title">{text.admin.renameTenant}</h2><p>{text.admin.renameTenantDescription}</p><form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void rename(event)}><label>{text.dashboard.tenantName}<input value={displayName} onChange={(event: ChangeEvent<HTMLInputElement>): void => setDisplayName(event.currentTarget.value)} required autoFocus /></label><button type="submit">{text.admin.save}</button><button type="button" className="button--secondary" onClick={closeRename}>{text.admin.cancel}</button></form></section></div>}{deleteTenant === null ? null : <div className="modal-backdrop"><section className="modal" aria-labelledby="delete-tenant-title"><h2 id="delete-tenant-title">{text.admin.deleteTenant}</h2><p>{text.admin.deleteTenantDescription}</p><p><strong>{deleteTenant.display_name}</strong></p><button type="button" onClick={(): void => void remove()}>{text.dashboard.confirmDelete}</button><button type="button" className="button--secondary" onClick={closeDelete}>{text.admin.cancel}</button></section></div>}</section>;
}

async function loadTenants(set: (tenants: CookbookTenant[]) => void, management: boolean): Promise<void> { const response: Response = await fetch(management ? '/api/admin/tenants' : '/api/cookbook/tenants', { credentials: 'same-origin' }); if (response.ok) set((await response.json() as { tenants: CookbookTenant[] }).tenants); }
async function updateTenant(publicId: string, body: { displayName?: string; disabled?: boolean }): Promise<Response> { return fetch(`/api/admin/tenants/${publicId}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
async function toggleDisabled(tenant: CookbookTenant, refresh: () => void): Promise<void> { const response: Response = await updateTenant(tenant.public_id, { disabled: tenant.disabled_at === null }); if (response.ok) refresh(); }
