import { useEffect, useRef, useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import { reauthenticationLoginUrl } from '../lib/login-navigation';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import { notifySessionChanged } from '../lib/browser/session-events';
import AccountMismatchNotice from './AccountMismatchNotice';
import StatusMessage from './StatusMessage';
import { withErrorBoundary } from './errors/withErrorBoundary';

interface VerificationResult {
  tenantSlug: string | null;
  authenticated: boolean;
}

function VerificationScreen({ text, token }: { text: Translation; token: string }): JSX.Element {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [message, setMessage] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [failed, setFailed] = useState<boolean>(false);
  const [accountMismatch, setAccountMismatch] = useState<boolean>(false);
  const requestedToken = useRef<string | null>(null);

  useEffect((): void => {
    if (requestedToken.current === token) return;
    requestedToken.current = token;
    void request<VerificationResult>('/registration/verify', jsonRequest({ token }))
      .then((verified: VerificationResult): void => {
        setResult(verified);
        if (verified.authenticated) {
          clearBrowserSessionCache();
          notifySessionChanged();
        }
      })
      .catch((error: unknown): void => {
        setFailed(true);
        if (error instanceof ApiRequestError && error.code === 'REGISTRATION_ACCOUNT_MISMATCH') {
          setAccountMismatch(true);
        } else setMessage(text.registration.verificationInvalid);
      });
  }, [text.registration.verificationInvalid, token]);

  async function resend(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await request('/registration/resend-verification', jsonRequest({ email }));
      setMessage(text.registration.resendSent);
    } catch (_error: unknown) {
      setMessage(text.registration.requestFailed);
    }
  }

  const destination: string = result?.tenantSlug
    ? `/${encodeURIComponent(result.tenantSlug)}`
    : '/settings/cookbooks';

  return (
    <section className="panel auth-panel">
      <h1>
        {result !== null
          ? text.registration.verificationSuccessTitle
          : failed
            ? text.registration.verificationFailedTitle
            : text.registration.verificationTitle}
      </h1>
      {result !== null ? (
        <>
          <p className="lede">
            {result.authenticated
              ? text.registration.verificationSucceeded
              : text.registration.verificationSignIn}
          </p>
          <a
            className="button-link"
            href={result.authenticated ? destination : reauthenticationLoginUrl(destination)}
          >
            {result.authenticated
              ? result.tenantSlug === null
                ? text.registration.continueToAccount
                : text.registration.continueToCookbook
              : text.login.title}
          </a>
        </>
      ) : accountMismatch ? (
        <AccountMismatchNotice
          text={text}
          returnPath={`/verify-email/${encodeURIComponent(token)}`}
        />
      ) : failed ? (
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void resend(event)}>
          <label>
            {text.registration.email}
            <input
              type="email"
              required
              value={email}
              onChange={(event): void => setEmail(event.currentTarget.value)}
            />
          </label>
          <button type="submit">{text.registration.resend}</button>
        </form>
      ) : null}
      <StatusMessage message={message} />
    </section>
  );
}

export default withErrorBoundary(VerificationScreen);
