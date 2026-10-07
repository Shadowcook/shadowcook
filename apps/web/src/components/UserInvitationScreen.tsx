import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';

interface Invitation {
  email: string;
  passwordRequired: boolean;
  existingAccount: boolean;
}

interface SessionResponse {
  email: string;
}

export default function UserInvitationScreen({
  locale,
  token,
}: {
  locale: Locale;
  token: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect((): void => {
    void fetch(`/api/user-invitations/${encodeURIComponent(token)}`)
      .then(async (response: Response): Promise<void> => {
        if (response.ok) setInvitation((await response.json()) as Invitation);
        else setMessage(text.userInvitation.unavailable);
      })
      .catch((): void => setMessage(text.userInvitation.unavailable));
    void fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(async (response: Response): Promise<void> => {
        if (response.ok) setSessionEmail(((await response.json()) as SessionResponse).email);
      })
      .catch((): void => undefined);
  }, [text.userInvitation.unavailable, token]);
  async function accept(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      `/api/user-invitations/${encodeURIComponent(token)}/accept`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          invitation?.existingAccount
            ? {}
            : {
                displayName,
                password: invitation?.passwordRequired ? password : undefined,
              },
        ),
      },
    );
    if (response.ok) {
      window.location.replace(invitation?.existingAccount ? '/' : '/login');
      return;
    }
    if (response.status === 401) setMessage(text.userInvitation.existingAccountSubtitle);
    else if (response.status === 403) setMessage(text.userInvitation.signedInWithDifferentEmail);
    else setMessage(text.userInvitation.unavailable);
  }
  if (invitation === null)
    return (
      <section className="panel">
        <h1>{text.userInvitation.title}</h1>
        <p className="message">{message || text.loading}</p>
      </section>
    );
  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{invitation.email}</p>
      <h1>
        {invitation.existingAccount
          ? text.userInvitation.existingAccountTitle
          : text.userInvitation.title}
      </h1>
      <p className="lede">
        {invitation.existingAccount
          ? text.userInvitation.existingAccountSubtitle
          : text.userInvitation.subtitle}
      </p>
      {invitation.existingAccount ? (
        sessionEmail === invitation.email ? (
          <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void accept(event)}>
            <button type="submit">{text.userInvitation.acceptCookbookInvitation}</button>
          </form>
        ) : sessionEmail === null ? (
          <button
            type="button"
            onClick={(): void =>
              window.location.assign(
                `/login?next=${encodeURIComponent(`/user-invitations/${token}`)}`,
              )
            }
          >
            {text.userInvitation.signInToAccept}
          </button>
        ) : (
          <p className="message" role="status">
            {text.userInvitation.signedInWithDifferentEmail}
          </p>
        )
      ) : (
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void accept(event)}>
          <label>
            {text.userInvitation.displayName}
            <input
              value={displayName}
              autoComplete="name"
              required
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setDisplayName(event.currentTarget.value)
              }
            />
          </label>
          {invitation.passwordRequired ? (
            <>
              <PasswordField
                text={text}
                label={text.userInvitation.password}
                value={password}
                autoComplete="new-password"
                required
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setPassword(event.currentTarget.value)
                }
              />
              <PasswordEntropyMeter text={text} password={password} />
            </>
          ) : null}
          <button type="submit">{text.userInvitation.accept}</button>
        </form>
      )}
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
