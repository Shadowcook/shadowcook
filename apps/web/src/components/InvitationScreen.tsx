import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import ProfileNameFields, { hasValidProfileNames, type ProfileNames } from './ProfileNameFields';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import AccountMismatchNotice from './AccountMismatchNotice';

interface Properties {
  locale: Locale;
  token: string;
}
interface Invitation {
  email: string | null;
  cookbookName: string | null;
  existingAccount: boolean;
}
interface AcceptanceResponse {
  cookbookSlug: string;
  hasPassword: boolean;
  passwordChangeRequired: boolean;
}

export default function InvitationScreen({ locale, token }: Properties): JSX.Element {
  const text: Translation = translations[locale];
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [code, setCode] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [names, setNames] = useState<ProfileNames>({
    firstName: '',
    lastName: '',
    displayName: '',
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [accountMismatch, setAccountMismatch] = useState<boolean>(false);

  useEffect((): void => {
    void request<Invitation>(`/invitations/${encodeURIComponent(token)}`)
      .then((result: Invitation): void => {
        setInvitation(result);
      })
      .catch((error: unknown): void => {
        if (error instanceof ApiRequestError && error.code === 'INVITATION_EMAIL_MISMATCH')
          setAccountMismatch(true);
        else setMessage(text.invitation.unavailable);
      });
  }, [token, text.invitation.unavailable]);
  async function accept(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (invitation === null || submitting) return;
    if (!invitation.existingAccount && !hasValidProfileNames(names)) {
      setMessage(text.accountProfile.nameRequirements);
      return;
    }
    const submittedCode: string = code;
    setCode('');
    setSubmitting(true);
    setMessage('');
    try {
      const accepted: AcceptanceResponse = await request<AcceptanceResponse>(
        `/invitations/${encodeURIComponent(token)}/accept`,
        jsonRequest(
          invitation.existingAccount ? { code: submittedCode } : { ...names, code: submittedCode },
        ),
      );
      const destination: string = `/${encodeURIComponent(accepted.cookbookSlug)}`;
      window.location.replace(destination);
    } catch (error: unknown) {
      const errorCode: string = error instanceof ApiRequestError ? error.code : '';
      if (errorCode === 'INVITATION_EMAIL_MISMATCH') setAccountMismatch(true);
      setMessage(
        errorCode === 'INVALID_ACCOUNT_PROFILE'
          ? text.accountProfile.nameRequirements
          : errorCode === 'INVITATION_EMAIL_MISMATCH'
            ? text.invitation.emailMismatch
            : text.invitation.unavailable,
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (accountMismatch)
    return (
      <section className="panel auth-panel">
        <h1>{text.invitation.title}</h1>
        <AccountMismatchNotice
          text={text}
          returnPath={`/invitations/${encodeURIComponent(token)}`}
        />
      </section>
    );
  if (invitation === null)
    return (
      <section className="panel">
        <h1>{text.invitation.title}</h1>
        <p className="message">{message || text.loading}</p>
      </section>
    );
  return (
    <section className="panel auth-panel">
      {invitation.cookbookName === null ? null : (
        <p className="eyebrow">{invitation.cookbookName}</p>
      )}
      <h1>{text.invitation.title}</h1>
      <p className="lede">{text.invitation.subtitle}</p>
      {invitation.email === null ? null : <p>{invitation.email}</p>}
      <form
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void accept(event)}
        autoComplete="off"
      >
        {!invitation.existingAccount ? (
          <ProfileNameFields text={text} value={names} onChange={setNames} />
        ) : null}
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
        <button
          type="submit"
          disabled={submitting || (!invitation.existingAccount && !hasValidProfileNames(names))}
        >
          {text.invitation.accept}
        </button>
      </form>
      {message.length === 0 ? null : (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
