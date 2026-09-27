import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';

interface Invitation {
  email: string;
  passwordRequired: boolean;
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

  useEffect((): void => {
    void fetch(`/api/user-invitations/${encodeURIComponent(token)}`)
      .then(async (response: Response): Promise<void> => {
        if (response.ok) setInvitation((await response.json()) as Invitation);
        else setMessage(text.userInvitation.unavailable);
      })
      .catch((): void => setMessage(text.userInvitation.unavailable));
  }, [text.userInvitation.unavailable, token]);
  async function accept(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      `/api/user-invitations/${encodeURIComponent(token)}/accept`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          password: invitation?.passwordRequired ? password : undefined,
        }),
      },
    );
    if (response.ok) {
      window.location.replace('/login');
      return;
    }
    setMessage(text.userInvitation.unavailable);
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
      <h1>{text.userInvitation.title}</h1>
      <p className="lede">{text.userInvitation.subtitle}</p>
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
          <label>
            {text.userInvitation.password}
            <input
              value={password}
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setPassword(event.currentTarget.value)
              }
            />
          </label>
        ) : null}
        <button type="submit">{text.userInvitation.accept}</button>
      </form>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
