import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import StatusMessage from './StatusMessage';

interface PasswordChangeProperties {
  text: Translation;
  currentPassword: string;
  newPassword: string;
  isSubmitting: boolean;
  message: string;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onCurrentPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onNewPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function PasswordChangeScreen(properties: PasswordChangeProperties): JSX.Element {
  const {
    text,
    currentPassword,
    newPassword,
    isSubmitting,
    message,
    onSubmit,
    onCurrentPasswordChange,
    onNewPasswordChange,
  } = properties;
  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.passwordChange.title}</p>
      <h1>{text.passwordChange.title}</h1>
      <p className="lede">{text.passwordChange.subtitle}</p>
      <form onSubmit={onSubmit}>
        <label>
          {text.passwordChange.currentPasswordLabel}
          <input
            value={currentPassword}
            onChange={onCurrentPasswordChange}
            type="password"
            autoComplete="current-password"
          />
        </label>
        <label>
          {text.passwordChange.newPasswordLabel}
          <input
            value={newPassword}
            onChange={onNewPasswordChange}
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? text.passwordChange.submitting : text.passwordChange.submit}
        </button>
      </form>
      <StatusMessage message={message} />
    </section>
  );
}
