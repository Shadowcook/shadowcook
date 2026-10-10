import { useEffect, useRef, useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import StatusMessage from './StatusMessage';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';
import CookbookUrlPreview from './CookbookUrlPreview';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void },
  ) => string;
  reset: (identifier?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function RegistrationScreen({ text }: { text: Translation }): JSX.Element {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [createCookbook, setCreateCookbook] = useState<boolean>(true);
  const [website, setWebsite] = useState<string>('');
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [siteKey, setSiteKey] = useState<string>('');
  const [turnstileRequired, setTurnstileRequired] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<'FORM' | 'ACCEPTED' | 'FAILED'>('FORM');
  const widgetContainer = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect((): (() => void) => {
    void request<{
      enabled: boolean;
      turnstileSiteKey: string;
      turnstileRequired: boolean;
    }>('/registration/config')
      .then(
        (config: {
          enabled: boolean;
          turnstileSiteKey: string;
          turnstileRequired: boolean;
        }): void => {
          setEnabled(config.enabled);
          setSiteKey(config.turnstileSiteKey);
          setTurnstileRequired(config.turnstileRequired);
        },
      )
      .catch((): void => setEnabled(false));
    if (!turnstileRequired || siteKey.length === 0) return (): void => undefined;
    const render = (): void => {
      if (
        widgetContainer.current === null ||
        window.turnstile === undefined ||
        widgetId.current !== null
      )
        return;
      widgetId.current = window.turnstile.render(widgetContainer.current, {
        sitekey: siteKey,
        callback: setTurnstileToken,
        'expired-callback': (): void => setTurnstileToken(''),
      });
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
    return (): void => script.remove();
  }, [siteKey, turnstileRequired]);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request(
        '/registration',
        jsonRequest({
          email,
          password,
          tenantName: createCookbook ? tenantName : null,
          turnstileToken,
          website,
        }),
      );
      setOutcome('ACCEPTED');
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiRequestError && error.code === 'REGISTRATION_DISABLED'
          ? text.registration.unavailable
          : text.registration.requestFailed,
      );
      setOutcome('FAILED');
      if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
      setTurnstileToken('');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.registration.title}</p>
      <h1>{text.registration.title}</h1>
      <p className="lede">{text.registration.subtitle}</p>
      {!enabled ? (
        <StatusMessage message={text.registration.unavailable} />
      ) : outcome === 'ACCEPTED' ? (
        <StatusMessage message={text.registration.checkEmail} />
      ) : outcome === 'FAILED' ? (
        <>
          <StatusMessage message={message} />
          <a className="button-link" href="/register">
            {text.registration.startAgain}
          </a>
        </>
      ) : (
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
          <label>
            {text.registration.email}
            <input
              type="email"
              autoComplete="email"
              value={email}
              required
              onChange={(event): void => setEmail(event.currentTarget.value)}
            />
          </label>
          <PasswordField
            text={text}
            label={text.registration.password}
            value={password}
            autoComplete="new-password"
            required
            onChange={(event): void => setPassword(event.currentTarget.value)}
          />
          <PasswordEntropyMeter text={text} password={password} />
          <fieldset>
            <legend>{text.registration.cookbookChoice}</legend>
            <label className="radio-option">
              <input
                type="radio"
                name="cookbook-timing"
                checked={createCookbook}
                onChange={(): void => setCreateCookbook(true)}
              />
              {text.registration.createCookbookNow}
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="cookbook-timing"
                checked={!createCookbook}
                onChange={(): void => setCreateCookbook(false)}
              />
              {text.registration.createCookbookLater}
            </label>
          </fieldset>
          {createCookbook ? (
            <label>
              {text.registration.cookbookName}
              <input
                type="text"
                minLength={3}
                maxLength={120}
                value={tenantName}
                required
                onChange={(event): void => setTenantName(event.currentTarget.value)}
              />
              <CookbookUrlPreview cookbookName={tenantName} text={text} />
            </label>
          ) : null}
          <div className="registration-honeypot" aria-hidden="true">
            <label>
              Website
              <input
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event): void => setWebsite(event.currentTarget.value)}
              />
            </label>
          </div>
          {turnstileRequired ? <div ref={widgetContainer} /> : null}
          <button
            type="submit"
            disabled={submitting || (turnstileRequired && turnstileToken.length === 0)}
          >
            {submitting ? text.registration.submitting : text.registration.submit}
          </button>
        </form>
      )}
      {outcome === 'FORM' ? <StatusMessage message={message} /> : null}
    </section>
  );
}

export function VerificationScreen({
  text,
  token,
}: {
  text: Translation;
  token: string;
}): JSX.Element {
  const [message, setMessage] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [completed, setCompleted] = useState<boolean>(false);
  useEffect((): void => {
    void request('/registration/verify', jsonRequest({ token }))
      .then((): void => {
        setCompleted(true);
        setMessage(text.registration.verificationSucceeded);
      })
      .catch((): void => setMessage(text.registration.verificationInvalid));
  }, [text.registration.verificationInvalid, text.registration.verificationSucceeded, token]);
  async function resend(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await request('/registration/resend-verification', jsonRequest({ email }));
    setMessage(text.registration.resendSent);
  }
  return (
    <section className="panel auth-panel">
      <h1>{text.registration.title}</h1>
      <StatusMessage message={message} />
      {!completed ? (
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
      ) : (
        <a className="button-link" href="/login">
          {text.login.title}
        </a>
      )}
    </section>
  );
}
