import { useEffect, useState, type JSX } from 'react';
import type { ErrorTranslation } from '../../i18n/errors';

export interface ErrorStateProps {
  text: ErrorTranslation;
  status?: number;
  network?: boolean;
  unexpected?: boolean;
  requestId?: string;
  retryAfterSeconds?: number;
  returnTo?: string;
  onRetry?: () => void;
}

export default function ErrorState({
  text,
  status,
  network,
  unexpected,
  requestId,
  retryAfterSeconds,
  returnTo = '/',
  onRetry,
}: ErrorStateProps): JSX.Element {
  const [waitingSeconds, setWaitingSeconds] = useState<number>(retryAfterSeconds ?? 0);
  useEffect((): (() => void) => {
    const deadline: number = Date.now() + (retryAfterSeconds ?? 0) * 1000;
    setWaitingSeconds(retryAfterSeconds ?? 0);
    if (retryAfterSeconds === undefined || retryAfterSeconds <= 0) return (): void => undefined;
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      setWaitingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return (): void => clearInterval(timer);
  }, [retryAfterSeconds, requestId]);
  const copy: { title: string; description: string } = network
    ? text.network
    : unexpected
      ? text.unexpected
      : status === 404 || status === 410
        ? text.notFound
        : status === 403
          ? text.denied
          : status === 401
            ? text.authentication
            : status === 429
              ? text.limited
              : status !== undefined && status < 500
                ? text.unexpected
                : text.service;
  return (
    <section className="panel error-state" role="alert">
      {status !== undefined && <p className="error-state__status">{status}</p>}
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      {retryAfterSeconds !== undefined && (
        <p>{text.wait.replace('{seconds}', String(waitingSeconds))}</p>
      )}
      {requestId && (
        <p>
          {text.requestId}: <code>{requestId}</code>
        </p>
      )}
      <div className="error-state__actions">
        {status !== 403 && status !== 404 && status !== 410 && status !== 401 && (
          <button
            type="button"
            disabled={waitingSeconds > 0}
            onClick={onRetry ?? ((): void => window.location.reload())}
          >
            {text.retry}
          </button>
        )}
        {status === 401 && (
          <a className="button-link" href={`/login?next=${encodeURIComponent(returnTo)}`}>
            {text.login}
          </a>
        )}
        <a className="button-link button--secondary" href="/">
          {text.home}
        </a>
      </div>
    </section>
  );
}
