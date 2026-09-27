import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import AdminIcon from './AdminIcon';

interface TenantRole {
  id: string;
  name: string;
}

interface TenantUser {
  public_id: string;
  email: string;
  display_name: string;
  roles: TenantRole[];
}

interface TenantUserResponse {
  users: TenantUser[];
  roles: TenantRole[];
}

interface Properties {
  locale: Locale;
  tenantSlug: string;
}

export default function TenantUserManagement({ locale, tenantSlug }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [message, setMessage] = useState<string>('');
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [showInvitation, setShowInvitation] = useState<boolean>(false);
  const [invitationEmail, setInvitationEmail] = useState<string>('');
  const [invitationRoleId, setInvitationRoleId] = useState<string>('');

  function refresh(): void {
    void loadTenantUsers(tenantSlug, setUsers, setRoles);
  }
  function openRoles(user: TenantUser): void {
    setEditingUser(user);
    setSelectedRoleIds(user.roles.map((role: TenantRole): string => role.id));
    setMessage('');
  }
  function toggleRole(roleId: string): void {
    setSelectedRoleIds((current: string[]): string[] =>
      current.includes(roleId)
        ? current.filter((currentRoleId: string): boolean => currentRoleId !== roleId)
        : [...current, roleId],
    );
  }
  async function saveRoles(): Promise<void> {
    if (editingUser === null || selectedRoleIds.length === 0) return;
    const response: Response = await fetch(
      `/api/cookbook/tenant-users/${editingUser.public_id}/roles?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleIds: selectedRoleIds }),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setEditingUser(null);
    setMessage(text.tenantUsers.rolesUpdated);
    refresh();
  }
  async function inviteUser(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      `/api/cookbook/tenant-users/invitations?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invitationEmail, roleId: invitationRoleId }),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setShowInvitation(false);
    setInvitationEmail('');
    setInvitationRoleId('');
    setMessage(text.tenantUsers.invitationSent);
  }
  useEffect(refresh, [tenantSlug]);

  return (
    <section className="admin-page admin-page--wide admin-page--users">
      <p className="eyebrow">{text.tenantNavigation.users}</p>
      <h1>{text.tenantUsers.title}</h1>
      <div className="dashboard__header">
        <p className="lede">{text.tenantUsers.description}</p>
        <button type="button" onClick={(): void => setShowInvitation(true)}>
          {text.tenantUsers.inviteUser}
        </button>
      </div>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <div className="user-table-container">
        <table className="tenant-table user-table">
          <thead>
            <tr>
              <th>{text.admin.userName}</th>
              <th>{text.admin.userEmail}</th>
              <th>{text.tenantUsers.roles}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user: TenantUser): JSX.Element => (
              <tr key={user.public_id}>
                <td>{user.display_name}</td>
                <td>{user.email}</td>
                <td>{user.roles.map((role: TenantRole): string => role.name).join(', ')}</td>
                <td>
                  <button
                    type="button"
                    aria-label={text.tenantUsers.assignRoles}
                    title={text.tenantUsers.assignRoles}
                    onClick={(): void => openRoles(user)}
                  >
                    <AdminIcon name="roles" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editingUser === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="tenant-role-assignment-title">
            <h2 id="tenant-role-assignment-title">{text.tenantUsers.assignRoles}</h2>
            <p>{editingUser.display_name}</p>
            <div className="role-assignment__options">
              {roles.map((role: TenantRole): JSX.Element => (
                <label className="role-assignment__option" key={role.id}>
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.includes(role.id)}
                    onChange={(_event: ChangeEvent<HTMLInputElement>): void => toggleRole(role.id)}
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
            <div className="role-assignment__actions">
              <button
                type="button"
                disabled={selectedRoleIds.length === 0}
                onClick={(): void => void saveRoles()}
              >
                {text.admin.save}
              </button>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => setEditingUser(null)}
              >
                {text.admin.cancel}
              </button>
            </div>
          </section>
        </div>
      )}
      {!showInvitation ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="tenant-user-invitation-title">
            <h2 id="tenant-user-invitation-title">{text.tenantUsers.inviteUser}</h2>
            <p>{text.tenantUsers.inviteUserDescription}</p>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void inviteUser(event)}>
              <label>
                {text.admin.userEmail}
                <input
                  type="email"
                  autoFocus
                  required
                  value={invitationEmail}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setInvitationEmail(event.currentTarget.value)
                  }
                />
              </label>
              <div className="role-assignment__options">
                {roles.map((role: TenantRole): JSX.Element => (
                  <label className="role-assignment__option" key={role.id}>
                    <input
                      type="radio"
                      name="tenant-role"
                      required
                      checked={invitationRoleId === role.id}
                      onChange={(): void => setInvitationRoleId(role.id)}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
              <div className="role-assignment__actions">
                <button type="submit">{text.admin.sendUserInvitation}</button>
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => setShowInvitation(false)}
                >
                  {text.admin.cancel}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

async function loadTenantUsers(
  tenantSlug: string,
  setUsers: (users: TenantUser[]) => void,
  setRoles: (roles: TenantRole[]) => void,
): Promise<void> {
  const response: Response = await fetch(
    `/api/cookbook/tenant-users?tenantSlug=${encodeURIComponent(tenantSlug)}`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) return;
  const payload: TenantUserResponse = (await response.json()) as TenantUserResponse;
  setUsers(payload.users);
  setRoles(payload.roles);
}
