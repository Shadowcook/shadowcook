import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import StatusMessage from './StatusMessage';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';
import AccountMismatchNotice from './AccountMismatchNotice';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import { reauthenticationLoginUrl } from '../lib/login-navigation';

type PasswordResetState = 'loading' | 'form' | 'mismatch' | 'invalid' | 'completed';

export default function PasswordResetScreen({
  text,
  token,
}: {
  text: Translation;
  token: string;
}): JSX.Element {
  const [newPassword, setNewPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [state, setState] = useState<PasswordResetState>('loading');

  function handleError(error: unknown): void {
    if (error instanceof ApiRequestError && error.code === 'PASSWORD_RESET_ACCOUNT_MISMATCH') {
      setState('mismatch');
      setNewPassword('');
      setMessage('');
    } else {
      setState(
        error instanceof ApiRequestError && error.code === 'INVALID_PASSWORD_RESET'
          ? 'invalid'
          : 'form',
      );
      setMessage(
        error instanceof ApiRequestError && error.code === 'INVALID_PASSWORD'
          ? text.accountPassword.invalidPassword
          : error instanceof ApiRequestError
            ? text.passwordReset.invalid
            : text.errors.requestFailed,
      );
    }
  }

  useEffect((): (() => void) => {
    let active: boolean = true;
    setState('loading');
    void request('/auth/password-reset/verification', jsonRequest({ token }))
      .then((): void => {
        if (active) setState('form');
      })
      .catch((error: unknown): void => {
        if (active) handleError(error);
      });
    return (): void => {
      active = false;
    };
  }, [token, text.passwordReset.invalid, text.errors.requestFailed]);

  async function complete(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting || state !== 'form') return;
    setIsSubmitting(true);
    setMessage('');
    try {
      await request<void>('/auth/password-reset/complete', jsonRequest({ token, newPassword }));
      setNewPassword('');
      clearBrowserSessionCache();
      setState('completed');
      setMessage(text.passwordReset.completed);
    } catch (error: unknown) {
      handleError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.passwordReset.title}</p>
      <h1>{text.passwordReset.title}</h1>
      <p className="lede">{text.passwordReset.subtitle}</p>
      {state === 'loading' ? (
        <StatusMessage message={text.loading} />
      ) : state === 'mismatch' ? (
        <AccountMismatchNotice
          text={text}
          returnPath={`/password-reset/${encodeURIComponent(token)}`}
        />
      ) : state === 'form' ? (
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void complete(event)}>
          <PasswordField
            text={text}
            label={text.passwordReset.newPassword}
            value={newPassword}
            autoComplete="new-password"
            required
            autoFocus
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setNewPassword(event.currentTarget.value)
            }
          />
          <PasswordEntropyMeter text={text} password={newPassword} />
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? text.passwordReset.submitting : text.passwordReset.submit}
          </button>
        </form>
      ) : null}
      <StatusMessage message={message} />
      {state === 'completed' ? (
        <a className="button-link" href={reauthenticationLoginUrl('/')}>
          {text.login.submit}
        </a>
      ) : null}
    </section>
  );
}
