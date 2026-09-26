import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';

interface Properties {
  locale: Locale;
  token: string;
}
interface Invitation {
  email: string;
  firstName: string;
  lastName: string;
  cookbookName: string;
}
interface ApiError {
  code?: string;
}

export default function InvitationScreen({ locale, token }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [code, setCode] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [emailMismatch, setEmailMismatch] = useState<boolean>(false);

  useEffect((): void => {
    void fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (response: Response): Promise<void> => {
        if (response.ok) setInvitation((await response.json()) as Invitation);
        else setMessage(text.invitation.unavailable);
      })
      .catch((): void => setMessage(text.invitation.unavailable));
  }, [token, text.invitation.unavailable]);
  async function accept(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setEmailMismatch(false);
    const submittedCode: string = code;
    setCode('');
    const response: Response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: submittedCode }),
    });
    if (response.ok) {
      setMessage(text.invitation.accepted);
      return;
    }
    const body: ApiError | null = await response.json().catch((): null => null);
    if (body?.code === 'INVITATION_EMAIL_MISMATCH') {
      setEmailMismatch(true);
      setMessage(text.invitation.emailMismatch);
      return;
    }
    setMessage(text.invitation.unavailable);
  }
  async function signOut(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setCode('');
    setEmailMismatch(false);
    setMessage('');
  }

  if (invitation === null)
    return (
      <section className="panel">
        <h1>{text.invitation.title}</h1>
        <p className="message">{message || text.loading}</p>
      </section>
    );
  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{invitation.cookbookName}</p>
      <h1>{text.invitation.title}</h1>
      <p className="lede">{text.invitation.subtitle}</p>
      <p>
        {invitation.firstName} {invitation.lastName} · {invitation.email}
      </p>
      <form
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void accept(event)}
        autoComplete="off"
      >
        <label>
          {text.invitation.codeLabel}
          <input
            value={code}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setCode(event.currentTarget.value)
            }
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{6}"
            required
          />
        </label>
        <button type="submit">{text.invitation.accept}</button>
      </form>
      {message.length === 0 ? null : (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {!emailMismatch ? null : (
        <button className="button--secondary" type="button" onClick={(): void => void signOut()}>
          {text.invitation.signOut}
        </button>
      )}
    </section>
  );
}
