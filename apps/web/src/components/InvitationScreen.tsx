import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import ProfileNameFields, { hasValidProfileNames, type ProfileNames } from './ProfileNameFields';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';

interface Properties {
  locale: Locale;
  token: string;
}
interface Invitation {
  email: string;
  cookbookName: string;
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
      <p>{invitation.email}</p>
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
