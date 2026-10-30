import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import StatusMessage from './StatusMessage';

interface EmailChangeStatus {
  email: string;
  pending: { email: string; expiresAt: string } | null;
  nextResendAt: string | null;
  serverTime: string;
}

interface TimedStatus {
  status: EmailChangeStatus;
  receivedAt: number;
}

export function emailChangeErrorMessage(error: unknown, text: Translation): string {
  if (!(error instanceof ApiRequestError)) return text.accountEmail.failed;
  switch (error.code) {
    case 'INVALID_EMAIL':
      return text.accountEmail.invalidEmail;
    case 'EMAIL_UNCHANGED':
      return text.accountEmail.unchanged;
    case 'EMAIL_UNAVAILABLE':
      return text.accountEmail.unavailable;
    case 'EMAIL_CHANGE_RATE_LIMITED':
      return text.accountEmail.rateLimited;
    case 'SMTP_REQUIRED':
      return text.accountEmail.smtpRequired;
    case 'EMAIL_CHANGE_DELIVERY_FAILED':
      return text.accountEmail.deliveryFailed;
    case 'NO_PENDING_EMAIL_CHANGE':
      return text.accountEmail.noPending;
    case 'AUTHENTICATION_REQUIRED':
      return text.accountSettings.signInRequired;
    case 'PASSWORD_CHANGE_REQUIRED':
      return text.accountEmail.passwordChangeRequired;
    case 'INVALID_EMAIL_CHANGE_TOKEN':
      return text.accountEmail.invalidLink;
    default:
      return text.accountEmail.failed;
  }
}

export default function AccountEmailSettings({ text }: { text: Translation }): JSX.Element {
  const [timedStatus, setTimedStatus] = useState<TimedStatus | null>(null);
  const [email, setEmail] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [now, setNow] = useState<number>(Date.now());

  function updateStatus(status: EmailChangeStatus): void {
    const receivedAt: number = Date.now();
    setTimedStatus({ status, receivedAt });
    setNow(receivedAt);
  }

  useEffect((): (() => void) => {
    let active: boolean = true;
    void request<EmailChangeStatus>('/account/email-change')
      .then((status: EmailChangeStatus): void => {
        if (active) updateStatus(status);
      })
      .catch((): void => {
        if (active) setMessage(text.accountEmail.loadFailed);
      });
    const timer: number = window.setInterval((): void => setNow(Date.now()), 1000);
    return (): void => {
      active = false;
      window.clearInterval(timer);
    };
  }, [text.accountEmail.loadFailed]);

  const status: EmailChangeStatus | undefined = timedStatus?.status;
  const serverNow: number =
    timedStatus === null
      ? now
      : Date.parse(timedStatus.status.serverTime) + now - timedStatus.receivedAt;
  const secondsRemaining: number =
    status?.nextResendAt === null || status === undefined
      ? 0
      : Math.max(0, Math.ceil((Date.parse(status.nextResendAt) - serverNow) / 1000));
  const pending: { email: string; expiresAt: string } | null =
    status?.pending !== undefined &&
    status.pending !== null &&
    Date.parse(status.pending.expiresAt) > serverNow
      ? status.pending
      : null;
  const validEmail: boolean =
    email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const countdown: string = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`;

  async function send(resend: boolean): Promise<void> {
    if (submitting || secondsRemaining > 0) return;
    setSubmitting(true);
    setMessage('');
    try {
      const response: EmailChangeStatus = await request<EmailChangeStatus>(
        resend ? '/account/email-change/resend' : '/account/email-change',
        jsonRequest(resend ? {} : { email }),
      );
      updateStatus(response);
      setEmail('');
      setMessage(text.accountEmail.sent);
    } catch (error: unknown) {
      setMessage(emailChangeErrorMessage(error, text));
      try {
        updateStatus(await request<EmailChangeStatus>('/account/email-change'));
      } catch (_error: unknown) {
        // Keep the last known server status when refreshing fails.
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="account-email-settings">
      <h2>{text.accountEmail.title}</h2>
      <p className="lede">{text.accountEmail.description}</p>
      {status === undefined ? (
        <StatusMessage message={message || text.loading} />
      ) : (
        <>
          <p>
            {text.accountEmail.currentEmail}: <strong>{status.email}</strong>
          </p>
          {pending === null ? null : (
            <div className="account-email-settings__pending">
              <p>{text.accountEmail.pending.replace('{email}', pending.email)}</p>
              <p>{text.accountEmail.linkLifetime}</p>
              <button
                type="button"
                disabled={submitting || secondsRemaining > 0}
                onClick={(): void => void send(true)}
              >
                {text.accountEmail.resend}
              </button>
            </div>
          )}
          <form
            noValidate
            onSubmit={(event: SubmitEvent<HTMLFormElement>): void => {
              event.preventDefault();
              if (!validEmail) {
                setMessage(text.accountEmail.invalidEmail);
                return;
              }
              void send(false);
            }}
          >
            <label>
              {text.accountEmail.newEmail}
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                disabled={submitting}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setEmail(event.currentTarget.value)
                }
              />
            </label>
            <button type="submit" disabled={submitting || !validEmail || secondsRemaining > 0}>
              {submitting ? text.accountEmail.sending : text.accountEmail.submit}
            </button>
          </form>
          {secondsRemaining > 0 ? (
            <p className="account-email-settings__cooldown">
              {text.accountEmail.resendCountdown.replace('{time}', countdown)}
            </p>
          ) : null}
          <StatusMessage message={message} />
        </>
      )}
    </section>
  );
}
