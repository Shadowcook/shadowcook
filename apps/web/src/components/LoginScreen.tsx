import { useEffect, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, JSX, KeyboardEvent, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import StatusMessage from './StatusMessage';

export interface AuthenticationMethods {
  password: boolean;
  emailCode: boolean;
}

interface LoginScreenProperties {
  text: Translation;
  email: string;
  password: string;
  emailCode: string;
  methods: AuthenticationMethods;
  isSubmitting: boolean;
  message: string;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onRequestCode: () => Promise<void>;
  onVerifyCode: (event: SubmitEvent<HTMLFormElement>) => void;
  onRequestPasswordReset: () => Promise<void>;
  onEmailChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCodeChange: (value: string) => void;
}

type LoginStep = 'email' | 'code' | 'password';

export default function LoginScreen(properties: LoginScreenProperties): JSX.Element {
  const {
    text,
    email,
    password,
    emailCode,
    methods,
    isSubmitting,
    message,
    onSubmit,
    onRequestCode,
    onVerifyCode,
    onRequestPasswordReset,
    onEmailChange,
    onPasswordChange,
    onCodeChange,
  } = properties;
  const [step, setStep] = useState<LoginStep>('email');

  async function continueWithEmail(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    onCodeChange('');
    if (methods.emailCode) {
      await onRequestCode();
      setStep('code');
    } else setStep('password');
  }

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    if (step === 'email') void continueWithEmail(event);
    else if (step === 'code') onVerifyCode(event);
    else onSubmit(event);
  }

  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.login.title}</p>
      <h1>{text.login.title}</h1>
      <p className="lede">{text.login.subtitle}</p>
      <form onSubmit={submit}>
        {step === 'email' ? (
          <label>
            {text.login.emailLabel}
            <input
              value={email}
              onChange={onEmailChange}
              type="email"
              autoComplete="email"
              required
              autoFocus
            />
          </label>
        ) : null}
        {step === 'code' ? (
          <>
            <p className="hint">{text.login.codeSent}</p>
            <CodeBoxes
              value={emailCode}
              label={text.login.emailCodeLabel}
              onChange={onCodeChange}
            />
            <button type="submit" disabled={isSubmitting}>
              {text.login.verifyCode}
            </button>
            {methods.password ? (
              <button
                className="button--secondary"
                type="button"
                onClick={(): void => {
                  onCodeChange('');
                  setStep('password');
                }}
              >
                {text.login.usePasswordInstead}
              </button>
            ) : null}
            <button
              className="button--secondary"
              type="button"
              onClick={(): void => {
                onCodeChange('');
                setStep('email');
              }}
            >
              {text.login.changeEmail}
            </button>
          </>
        ) : null}
        {step === 'password' ? (
          <>
            <label>
              {text.login.passwordLabel}
              <input
                value={password}
                onChange={onPasswordChange}
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            <button
              className="button--secondary"
              type="button"
              onClick={(): void => void onRequestPasswordReset()}
            >
              {text.login.resetPassword}
            </button>
          </>
        ) : null}
        {step !== 'code' ? (
          <button type="submit" disabled={isSubmitting}>
            {step === 'email'
              ? text.login.requestCode
              : isSubmitting
                ? text.login.submitting
                : text.login.submit}
          </button>
        ) : null}
      </form>
      <StatusMessage message={message} />
      {step === 'email' ? <p className="hint">{text.login.developmentCredentials}</p> : null}
    </section>
  );
}

interface CodeBoxesProperties {
  value: string;
  label: string;
  onChange: (value: string) => void;
}

function CodeBoxes({ value, label, onChange }: CodeBoxesProperties): JSX.Element {
  const [digits, setDigits] = useState<string[]>((): string[] => digitsFromCode(value));
  useEffect((): void => {
    if (value.length === 0) setDigits(emptyDigits());
  }, [value]);
  function commit(next: string[]): void {
    setDigits(next);
    onChange(next.join(''));
  }
  function fillFrom(index: number, input: string): void {
    const pastedDigits: string = input.replace(/\D/g, '').slice(0, digits.length - index);
    const next: string[] = digits.slice();
    if (pastedDigits.length === 0) {
      next[index] = '';
      commit(next);
      return;
    }
    for (let offset: number = 0; offset < pastedDigits.length; offset += 1)
      next[index + offset] = pastedDigits[offset]!;
    commit(next);
    const nextIndex: number = index + pastedDigits.length;
    if (nextIndex < digits.length) focusCodeField(nextIndex);
  }
  function backspace(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (digits[index] !== '' || index === 0) return;
    event.preventDefault();
    const next: string[] = digits.slice();
    next[index - 1] = '';
    commit(next);
    focusCodeField(index - 1);
  }
  function paste(index: number, event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    fillFrom(index, event.clipboardData.getData('text'));
  }
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="code-boxes">
        {digits.map((digit: string, index: number): JSX.Element => (
          <input
            aria-label={`${label} ${index + 1}`}
            id={`email-code-${index}`}
            key={index}
            value={digit}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              fillFrom(index, event.currentTarget.value)
            }
            onPaste={(event: ClipboardEvent<HTMLInputElement>): void => paste(index, event)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
              if (event.key === 'Backspace') backspace(index, event);
            }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            required
          />
        ))}
      </div>
    </fieldset>
  );
}

function emptyDigits(): string[] {
  return ['', '', '', '', '', ''];
}
function digitsFromCode(value: string): string[] {
  const digits: string[] = emptyDigits();
  for (let index: number = 0; index < Math.min(value.length, digits.length); index += 1)
    digits[index] = value[index]!;
  return digits;
}
function focusCodeField(index: number): void {
  document.getElementById(`email-code-${index}`)?.focus();
}
