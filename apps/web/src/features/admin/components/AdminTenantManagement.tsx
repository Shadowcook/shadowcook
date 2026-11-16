import DeletionControl from '../safety/DeletionControl';
import ModerationControl from '../moderation/ModerationControl';
import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import AdminTenantCreate from './AdminTenantCreate';
import AdminIcon from '../../../components/AdminIcon';
import MessageDialog from '../../../components/MessageDialog';
import type { CookbookTenant } from '../../cookbook/model/types';

interface AdminCookbookTenant extends CookbookTenant {
  name_reset_required: boolean;
}

interface AdminTenantManagementProperties {
  locale: Locale;
  canInspect?: boolean;
}

export default function AdminTenantManagement({
  locale,
  canInspect = false,
}: AdminTenantManagementProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [tenants, setTenants] = useState<AdminCookbookTenant[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [smtpConfigured, setSmtpConfigured] = useState<boolean>(false);
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [resetTenant, setResetTenant] = useState<AdminCookbookTenant | null>(null);
  const [message, setMessage] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<string>('');
  function refresh(): void {
    void loadTenants(setTenants, setSmtpConfigured);
  }
  function tenantCreated(): void {
    setShowCreate(false);
    setToast(text.admin.tenantCreated);
    refresh();
  }
  async function forceReset(): Promise<void> {
    if (resetTenant === null || saving) return;
    setSaving(true);
    try {
      const response: Response = await fetch(
        `/api/admin/tenants/${resetTenant.public_id}/force-reset`,
        {
          method: resetTenant.name_reset_required === true ? 'DELETE' : 'POST',
          credentials: 'same-origin',
        },
      );
      if (!response.ok) {
        setMessage(text.errors.requestFailed);
        return;
      }
      setResetTenant(null);
      setMessage(
        resetTenant.name_reset_required === true
          ? text.cookbookIdentity.resetCancelled
          : text.cookbookIdentity.resetDone,
      );
      refresh();
    } catch {
      setMessage(text.errors.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  const visible: AdminCookbookTenant[] = tenants.filter((tenant: AdminCookbookTenant): boolean =>
    `${tenant.display_name} ${tenant.slug}`.toLowerCase().includes(filter.toLowerCase()),
  );
  useEffect(refresh, []);
  useEffect((): (() => void) | undefined => {
    if (toast.length === 0) return undefined;
    const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => setToast(''), 5000);
    return (): void => clearTimeout(timeout);
  }, [toast]);
  return (
    <section className="admin-page admin-page--wide">
      <div className="dashboard__header">
        <h1>{text.admin.tenantsTitle}</h1>
        <button
          className="admin-create-action"
          title={text.admin.createTenant}
          disabled={!smtpConfigured}
          aria-describedby={!smtpConfigured ? 'tenant-creation-smtp-required' : undefined}
          onClick={(): void => setShowCreate(true)}
        >
          <AdminIcon name="add" />
          {text.admin.createTenant}
        </button>
      </div>
      {!smtpConfigured ? (
        <p className="hint" id="tenant-creation-smtp-required">
          {text.admin.tenantCreationSmtpRequired}
        </p>
      ) : null}
      <label>
        {text.dashboard.filterTenants}
        <input
          value={filter}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            setFilter(event.currentTarget.value)
          }
          type="search"
        />
      </label>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <div
        className="admin-cookbook-table-container"
        role="region"
        aria-label={text.admin.tenantsTitle}
        tabIndex={0}
      >
        <table className="tenant-table admin-cookbook-table">
          <thead>
            <tr>
              <th>{text.dashboard.tenantName}</th>
              <th>{text.admin.tenantSlug}</th>
              <th>{text.dashboard.tenantOwner}</th>
              <th>{text.dashboard.recipes}</th>
              <th>{text.cookbookIdentity.status}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tenant: AdminCookbookTenant): JSX.Element => (
              <tr key={tenant.public_id}>
                <td>
                  {canInspect ? (
                    <a href={`/admin/tenants/${tenant.public_id}/inspection`}>
                      {tenant.display_name}
                    </a>
                  ) : (
                    tenant.display_name
                  )}
                </td>
                <td>{tenant.slug}</td>
                <td>{tenant.owner_name ?? ''}</td>
                <td>{tenant.recipe_count}</td>
                <td>
                  {tenant.disabled_at !== null ? <p>{text.cookbookIdentity.disabled}</p> : null}
                  {tenant.name_reset_required === true ? (
                    <p>{text.cookbookIdentity.resetPending}</p>
                  ) : null}
                  {tenant.disabled_at === null && tenant.name_reset_required !== true
                    ? text.cookbookIdentity.active
                    : null}
                </td>
                <td>
                  <div className="tenant-actions admin-record-actions">
                    {canInspect ? (
                      <ModerationControl
                        compact
                        tenantId={tenant.public_id}
                        blocked={tenant.disabled_at !== null}
                        name={tenant.display_name}
                        text={text}
                        onSaved={refresh}
                      />
                    ) : null}
                    <button
                      aria-label={
                        tenant.name_reset_required === true
                          ? text.cookbookIdentity.cancelReset
                          : text.cookbookIdentity.forceReset
                      }
                      title={
                        tenant.name_reset_required === true
                          ? text.cookbookIdentity.cancelReset
                          : text.cookbookIdentity.forceReset
                      }
                      onClick={(): void => setResetTenant(tenant)}
                    >
                      <AdminIcon
                        name={tenant.name_reset_required === true ? 'cancelReset' : 'forceReset'}
                      />
                    </button>
                    {canInspect ? (
                      <DeletionControl
                        compact
                        tenantId={tenant.public_id}
                        name={tenant.display_name}
                        text={text}
                        onDeleted={refresh}
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast.length === 0 ? null : (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
      {showCreate ? (
        <div className="modal-backdrop">
          <section className="modal">
            <button onClick={(): void => setShowCreate(false)}>{text.dashboard.close}</button>
            <AdminTenantCreate
              locale={locale}
              onCreated={tenantCreated}
              smtpConfigured={smtpConfigured}
            />
          </section>
        </div>
      ) : null}
      {resetTenant === null ? null : (
        <MessageDialog
          kind="confirmation"
          text={text.dialog}
          title={
            resetTenant.name_reset_required === true
              ? text.cookbookIdentity.cancelReset
              : text.cookbookIdentity.forceReset
          }
          busy={saving}
          message={
            resetTenant.name_reset_required === true
              ? text.cookbookIdentity.cancelResetDescription
              : text.cookbookIdentity.resetDescription
          }
          confirmLabel={
            resetTenant.name_reset_required === true
              ? text.cookbookIdentity.cancelReset
              : text.cookbookIdentity.forceReset
          }
          onConfirm={(): void => void forceReset()}
          onClose={(): void => {
            if (!saving) setResetTenant(null);
          }}
        >
          <p>
            <strong>{resetTenant.display_name}</strong>
          </p>
        </MessageDialog>
      )}
    </section>
  );
}

async function loadTenants(
  setTenants: (tenants: AdminCookbookTenant[]) => void,
  setSmtpConfigured: (value: boolean) => void,
): Promise<void> {
  const response: Response = await fetch('/api/admin/tenants', { credentials: 'same-origin' });
  if (!response.ok) return;
  const body = (await response.json()) as {
    tenants: AdminCookbookTenant[];
    smtpConfigured?: unknown;
  };
  setTenants(body.tenants);
  setSmtpConfigured(body.smtpConfigured === true);
}
