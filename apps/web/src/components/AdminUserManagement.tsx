import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import AdminIcon from './AdminIcon';

interface UserTenant {
  publicId: string;
  name: string;
}
interface ManagedUser {
  public_id: string;
  email: string;
  display_name: string;
  password_change_required: boolean;
  disabled_at: string | null;
  deleted_at: string | null;
  last_login_at: string | null;
  tenants: UserTenant[];
  instance_roles: string[];
}
interface InstanceRole {
  code: string;
  name: string;
}

export default function AdminUserManagement({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [showInvitation, setShowInvitation] = useState<boolean>(false);
  const [invitationEmail, setInvitationEmail] = useState<string>('');
  const [invitationRoleCode, setInvitationRoleCode] = useState<string>('user');
  const [renamingUser, setRenamingUser] = useState<ManagedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<ManagedUser | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<ManagedUser | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [instanceRoles, setInstanceRoles] = useState<InstanceRole[]>([]);
  const [roleUser, setRoleUser] = useState<ManagedUser | null>(null);
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);

  function refresh(): void {
    void loadUsers(setUsers);
  }
  function closeRename(): void {
    setRenamingUser(null);
    setDisplayName('');
  }
  function closePasswordReset(): void {
    setResettingPasswordFor(null);
  }
  function openRename(user: ManagedUser): void {
    setRenamingUser(user);
    setDisplayName(user.display_name);
    setMessage('');
  }
  function openInstanceRoles(user: ManagedUser): void {
    setRoleUser(user);
    setSelectedRoleCodes(user.instance_roles);
    setMessage('');
  }
  function toggleInstanceRole(code: string): void {
    setSelectedRoleCodes((current: string[]): string[] =>
      current.includes(code)
        ? current.filter((currentCode: string): boolean => currentCode !== code)
        : [...current, code],
    );
  }
  async function saveInstanceRoles(): Promise<void> {
    if (roleUser === null) return;
    const response: Response = await fetch(
      `/api/admin/users/${roleUser.public_id}/instance-roles`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleCodes: selectedRoleCodes }),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setRoleUser(null);
    setMessage(text.admin.instanceRolesUpdated);
    refresh();
  }
  async function rename(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (renamingUser === null) return;
    const response: Response = await updateUser(renamingUser.public_id, { displayName });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    closeRename();
    setMessage(text.admin.userRenamed);
    refresh();
  }
  async function inviteUser(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch('/api/admin/users/invitations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: invitationEmail, roleCode: invitationRoleCode }),
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setShowInvitation(false);
    setInvitationEmail('');
    setMessage(text.admin.userInvitationSent);
  }
  async function toggleDisabled(user: ManagedUser): Promise<void> {
    const response: Response = await updateUser(user.public_id, {
      disabled: user.disabled_at === null,
    });
    setMessage(response.ok ? text.admin.userStatusUpdated : text.errors.requestFailed);
    if (response.ok) refresh();
  }
  async function resetPassword(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (resettingPasswordFor === null) return;
    const response: Response = await fetch(
      `/api/admin/users/${resettingPasswordFor.public_id}/reset-password`,
      {
        method: 'POST',
        credentials: 'same-origin',
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    closePasswordReset();
    setMessage(text.admin.passwordReset);
    refresh();
  }
  async function remove(): Promise<void> {
    if (deletingUser === null) return;
    const response: Response = await fetch(`/api/admin/users/${deletingUser.public_id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setDeletingUser(null);
    setMessage(text.admin.userDeleted);
    refresh();
  }
  const visibleUsers: ManagedUser[] = users.filter((user: ManagedUser): boolean =>
    `${user.display_name} ${user.email} ${user.tenants.map((tenant: UserTenant): string => tenant.name).join(' ')}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  useEffect(refresh, []);
  useEffect((): void => {
    void loadInstanceRoles(setInstanceRoles);
  }, []);

  return (
    <section className="admin-page admin-page--wide admin-page--users">
      <div className="dashboard__header">
        <div>
          <p className="eyebrow">{text.admin.users}</p>
          <h1>{text.admin.usersTitle}</h1>
        </div>
        <button onClick={(): void => setShowInvitation(true)}>{text.admin.addUser}</button>
      </div>
      <p className="lede">{text.admin.usersDescription}</p>
      <label>
        {text.admin.filterUsers}
        <input
          value={filter}
          type="search"
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            setFilter(event.currentTarget.value)
          }
        />
      </label>
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
              <th>{text.admin.userTenants}</th>
              <th>{text.admin.instanceRoles}</th>
              <th>{text.admin.userStatus}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user: ManagedUser): JSX.Element => (
              <tr key={user.public_id}>
                <td>{user.display_name}</td>
                <td>{user.email}</td>
                <td>{user.tenants.map((tenant: UserTenant): string => tenant.name).join(', ')}</td>
                <td>{user.instance_roles.join(', ')}</td>
                <td>{userStatus(text, user)}</td>
                <td>
                  {user.deleted_at === null ? (
                    <div className="tenant-actions">
                      <button
                        aria-label={text.admin.assignInstanceRoles}
                        title={text.admin.assignInstanceRoles}
                        onClick={(): void => openInstanceRoles(user)}
                      >
                        <AdminIcon name="roles" />
                      </button>
                      <button
                        aria-label={
                          user.disabled_at === null
                            ? text.admin.deactivateUser
                            : text.admin.activateUser
                        }
                        title={
                          user.disabled_at === null
                            ? text.admin.deactivateUser
                            : text.admin.activateUser
                        }
                        onClick={(): void => void toggleDisabled(user)}
                      >
                        <AdminIcon name={user.disabled_at === null ? 'disable' : 'enable'} />
                      </button>
                      <button
                        aria-label={text.admin.renameUser}
                        title={text.admin.renameUser}
                        onClick={(): void => openRename(user)}
                      >
                        <AdminIcon name="edit" />
                      </button>
                      <button
                        aria-label={text.admin.resetUserPassword}
                        title={text.admin.resetUserPassword}
                        onClick={(): void => {
                          setResettingPasswordFor(user);
                          setMessage('');
                        }}
                      >
                        <AdminIcon name="resetPassword" />
                      </button>
                      <button
                        aria-label={text.admin.deleteUser}
                        title={text.admin.deleteUser}
                        onClick={(): void => {
                          setDeletingUser(user);
                          setMessage('');
                        }}
                      >
                        <AdminIcon name="delete" />
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {renamingUser === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="rename-user-title">
            <h2 id="rename-user-title">{text.admin.renameUser}</h2>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void rename(event)}>
              <label>
                {text.admin.userName}
                <input
                  value={displayName}
                  autoFocus
                  required
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setDisplayName(event.currentTarget.value)
                  }
                />
              </label>
              <button type="submit">{text.admin.save}</button>
              <button type="button" className="button--secondary" onClick={closeRename}>
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
      {roleUser === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="instance-role-assignment-title">
            <h2 id="instance-role-assignment-title">{text.admin.assignInstanceRoles}</h2>
            <p>{roleUser.display_name}</p>
            <div className="role-assignment__options">
              {instanceRoles.map((role: InstanceRole): JSX.Element => (
                <label className="role-assignment__option" key={role.code}>
                  <input
                    type="checkbox"
                    checked={selectedRoleCodes.includes(role.code)}
                    onChange={(_event: ChangeEvent<HTMLInputElement>): void =>
                      toggleInstanceRole(role.code)
                    }
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
            <div className="role-assignment__actions">
              <button type="button" onClick={(): void => void saveInstanceRoles()}>
                {text.admin.save}
              </button>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => setRoleUser(null)}
              >
                {text.admin.cancel}
              </button>
            </div>
          </section>
        </div>
      )}
      {!showInvitation ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="invite-user-title">
            <h2 id="invite-user-title">{text.admin.addUser}</h2>
            <p>{text.admin.addUserDescription}</p>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void inviteUser(event)}>
              <label>
                {text.admin.userEmail}
                <input
                  value={invitationEmail}
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setInvitationEmail(event.currentTarget.value)
                  }
                />
              </label>
              <div className="role-assignment__options">
                {instanceRoles.map((role: InstanceRole): JSX.Element => (
                  <label className="role-assignment__option" key={role.code}>
                    <input
                      type="radio"
                      name="instance-role"
                      checked={invitationRoleCode === role.code}
                      onChange={(): void => setInvitationRoleCode(role.code)}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
              <button type="submit">{text.admin.sendUserInvitation}</button>
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => setShowInvitation(false)}
              >
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
      {resettingPasswordFor === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="reset-user-password-title">
            <h2 id="reset-user-password-title">{text.admin.resetUserPassword}</h2>
            <p>{text.admin.resetUserPasswordDescription}</p>
            <form
              onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void resetPassword(event)}
            >
              <button type="submit">{text.admin.resetUserPassword}</button>
              <button type="button" className="button--secondary" onClick={closePasswordReset}>
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
      {deletingUser === null ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="delete-user-title">
            <h2 id="delete-user-title">{text.admin.deleteUser}</h2>
            <p>{text.admin.deleteUserDescription}</p>
            <p>
              <strong>{deletingUser.display_name}</strong>
            </p>
            <button type="button" onClick={(): void => void remove()}>
              {text.dashboard.confirmDelete}
            </button>
            <button
              type="button"
              className="button--secondary"
              onClick={(): void => setDeletingUser(null)}
            >
              {text.admin.cancel}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

function userStatus(text: Translation, user: ManagedUser): string {
  if (user.deleted_at !== null) return text.admin.userDeletedStatus;
  if (user.disabled_at !== null) return text.admin.userDeactivated;
  if (user.password_change_required) return text.admin.userPasswordChangeRequired;
  return text.admin.userActive;
}
async function loadUsers(setUsers: (users: ManagedUser[]) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/users', { credentials: 'same-origin' });
  if (response.ok) setUsers(((await response.json()) as { users: ManagedUser[] }).users);
}
async function loadInstanceRoles(setRoles: (roles: InstanceRole[]) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/instance-roles', {
    credentials: 'same-origin',
  });
  if (response.ok) setRoles(((await response.json()) as { roles: InstanceRole[] }).roles);
}
async function updateUser(
  publicId: string,
  body: { displayName?: string; disabled?: boolean },
): Promise<Response> {
  return fetch(`/api/admin/users/${publicId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
