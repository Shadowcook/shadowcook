import { useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from './api-client';
import StatusMessage from './StatusMessage';

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

  async function complete(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage('');
    try {
      await request<void>('/auth/password-reset/complete', jsonRequest({ token, newPassword }));
      setMessage(text.passwordReset.completed);
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiRequestError ? text.passwordReset.invalid : text.errors.requestFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.passwordReset.title}</p>
      <h1>{text.passwordReset.title}</h1>
      <p className="lede">{text.passwordReset.subtitle}</p>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void complete(event)}>
        <label>
          {text.passwordReset.newPassword}
          <input
            value={newPassword}
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
            autoFocus
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setNewPassword(event.currentTarget.value)
            }
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? text.passwordReset.submitting : text.passwordReset.submit}
        </button>
      </form>
      <StatusMessage message={message} />
    </section>
  );
}
