import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import { reauthenticationLoginUrl } from '../lib/login-navigation';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import { emailChangeErrorMessage } from './AccountEmailSettings';
import StatusMessage from './StatusMessage';

type VerificationState =
  'loading' | 'ready' | 'sign-in' | 'mismatch' | 'reauthenticate' | 'error' | 'confirmed';

interface EmailChangeVerification {
  currentEmail: string;
  email: string;
  expiresAt: string;
  reauthenticationRequired: boolean;
}

export default function EmailChangeVerificationScreen({
  text,
  token,
}: {
  text: Translation;
  token: string;
}): JSX.Element {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [state, setState] = useState<VerificationState>('loading');
  const [verification, setVerification] = useState<EmailChangeVerification | null>(null);
  const [message, setMessage] = useState<string>('');
  const returnPath: string = `/settings/email/verify/${encodeURIComponent(token)}`;
  const loginUrl: string = reauthenticationLoginUrl(returnPath);

  function handleError(error: unknown): void {
    const code: string = error instanceof ApiRequestError ? error.code : 'REQUEST_FAILED';
    if (code === 'AUTHENTICATION_REQUIRED') {
      setState('sign-in');
      setVerification(null);
      setMessage(text.accountEmail.signInToConfirm);
    } else if (code === 'EMAIL_CHANGE_ACCOUNT_MISMATCH') {
      setState('mismatch');
      setVerification(null);
      setMessage(text.accountEmail.accountMismatch);
    } else if (code === 'REAUTHENTICATION_REQUIRED' || code === 'PASSWORD_CHANGE_REQUIRED') {
      setState('reauthenticate');
      setMessage(
        code === 'PASSWORD_CHANGE_REQUIRED'
          ? text.accountEmail.passwordChangeRequired
          : text.accountEmail.reauthenticationRequired,
      );
    } else {
      setState('error');
      setMessage(emailChangeErrorMessage(error, text));
    }
  }

  async function loadVerification(signal?: AbortSignal): Promise<void> {
    setState('loading');
    setMessage('');
    try {
      const result: EmailChangeVerification = await request<EmailChangeVerification>(
        '/account/email-change/verification',
        { ...jsonRequest({ token }), signal },
      );
      if (signal?.aborted) return;
      setVerification(result);
      setState(result.reauthenticationRequired ? 'reauthenticate' : 'ready');
      if (result.reauthenticationRequired) setMessage(text.accountEmail.reauthenticationRequired);
    } catch (error: unknown) {
      if (!signal?.aborted) handleError(error);
    }
  }

  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    void loadVerification(controller.signal);
    return (): void => controller.abort();
  }, [token, text]);

  async function confirmEmailAddress(): Promise<void> {
    if (submitting || state !== 'ready') return;
    setSubmitting(true);
    setMessage('');
    try {
      await request('/account/email-change/verify', jsonRequest({ token }));
      clearBrowserSessionCache();
      setState('confirmed');
      setMessage(text.accountEmail.confirmed);
    } catch (error: unknown) {
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function switchAccount(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      await request<void>('/auth/logout', { method: 'POST' });
      clearBrowserSessionCache();
      window.location.assign(loginUrl);
    } catch (_error: unknown) {
      setMessage(text.headBar.signOutFailed);
      setSubmitting(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <h1>{text.accountEmail.confirmTitle}</h1>
      <p className="lede">{text.accountEmail.confirmDescription}</p>
      {verification !== null && (state === 'ready' || state === 'reauthenticate') ? (
        <div className="account-email-settings__pending">
          <p>
            {text.accountEmail.currentEmail}: <strong>{verification.currentEmail}</strong>
          </p>
          <p>
            {text.accountEmail.newEmail}: <strong>{verification.email}</strong>
          </p>
        </div>
      ) : null}
      <StatusMessage message={state === 'loading' ? text.loading : message} />
      <div className="email-change-verification__actions">
        {state === 'ready' ? (
          <button
            type="button"
            disabled={submitting}
            onClick={(): void => void confirmEmailAddress()}
          >
            {submitting ? text.accountEmail.confirming : text.accountEmail.confirm}
          </button>
        ) : state === 'sign-in' || state === 'reauthenticate' ? (
          <a className="button-link" href={loginUrl}>
            {state === 'sign-in' ? text.login.submit : text.accountEmail.signInAgain}
          </a>
        ) : state === 'mismatch' ? (
          <button type="button" disabled={submitting} onClick={(): void => void switchAccount()}>
            {text.accountEmail.switchAccount}
          </button>
        ) : state === 'error' ? (
          <button type="button" onClick={(): void => void loadVerification()}>
            {text.accountEmail.retry}
          </button>
        ) : null}
        {state === 'confirmed' ? (
          <a className="button-link" href="/settings/email">
            {text.headBar.accountSettings}
          </a>
        ) : null}
      </div>
    </section>
  );
}
