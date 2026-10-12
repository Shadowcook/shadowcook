import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';
import ProfileNameFields, { hasValidProfileNames, type ProfileNames } from './ProfileNameFields';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';

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
  const [names, setNames] = useState<ProfileNames>({
    firstName: '',
    lastName: '',
    displayName: '',
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
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
    if (invitation === null || submitting) return;
    if (!invitation.existingAccount && !hasValidProfileNames(names)) {
      setMessage(text.accountProfile.nameRequirements);
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      await request<void>(
        `/user-invitations/${encodeURIComponent(token)}/accept`,
        jsonRequest(
          invitation.existingAccount
            ? {}
            : {
                ...names,
                password: invitation.passwordRequired ? password : undefined,
              },
        ),
      );
      window.location.replace(invitation?.existingAccount ? '/' : '/login');
    } catch (error: unknown) {
      const code: string = error instanceof ApiRequestError ? error.code : '';
      setMessage(
        code === 'INVALID_ACCOUNT_PROFILE'
          ? text.accountProfile.nameRequirements
          : code === 'INVALID_PASSWORD'
            ? text.userInvitation.invalidPassword
            : code === 'INVITATION_LOGIN_REQUIRED'
              ? text.userInvitation.existingAccountSubtitle
              : code === 'INVITATION_EMAIL_MISMATCH'
                ? text.userInvitation.signedInWithDifferentEmail
                : text.userInvitation.unavailable,
      );
    } finally {
      setSubmitting(false);
    }
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
            <button type="submit" disabled={submitting}>
              {text.userInvitation.acceptCookbookInvitation}
            </button>
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
          <ProfileNameFields text={text} value={names} onChange={setNames} />
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
          <button type="submit" disabled={submitting || !hasValidProfileNames(names)}>
            {text.userInvitation.accept}
          </button>
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
