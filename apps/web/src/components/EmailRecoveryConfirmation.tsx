import { useEffect, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import type { Translation } from '../i18n';
import { jsonRequest, request, ApiRequestError } from '../lib/api/client';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import { notifySessionChanged } from '../lib/browser/session-events';
import { reauthenticationLoginUrl } from '../lib/login-navigation';
import StatusMessage from './StatusMessage';
import { withErrorBoundary } from './errors/withErrorBoundary';

function EmailRecoveryConfirmation({
  text,
  token,
}: {
  text: Translation;
  token: string;
}): JSX.Element {
  const [completed, setCompleted] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const requestedToken: RefObject<string | null> = useRef<string | null>(null);

  useEffect((): void => {
    if (requestedToken.current === token) return;
    requestedToken.current = token;
    void request<void>('/auth/email-recovery/complete', jsonRequest({ token }))
      .then((): void => {
        clearBrowserSessionCache();
        notifySessionChanged();
        setCompleted(true);
        setMessage(text.safety.recoveryConfirmed);
      })
      .catch((error: unknown): void => {
        setMessage(
          error instanceof ApiRequestError && error.code === 'EMAIL_UNAVAILABLE'
            ? text.safety.emailUnavailable
            : error instanceof ApiRequestError && error.code === 'INVALID_RECOVERY_PROOF'
              ? text.safety.invalidProof
              : text.errors.requestFailed,
        );
      });
  }, [token, text]);

  return (
    <section className="panel auth-panel">
      <h1>{text.safety.recoveryConfirm}</h1>
      <StatusMessage message={message || text.loading} />
      {completed ? (
        <a className="button-link" href={reauthenticationLoginUrl('/')}>
          {text.login.submit}
        </a>
      ) : null}
    </section>
  );
}

export default withErrorBoundary(EmailRecoveryConfirmation);
