import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import StatusMessage from './StatusMessage';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';

interface PasswordChangeProperties {
  text: Translation;
  hasPassword: boolean;
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
    hasPassword,
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
        {!hasPassword ? null : (
          <PasswordField
            text={text}
            label={text.passwordChange.currentPasswordLabel}
            value={currentPassword}
            onChange={onCurrentPasswordChange}
            autoComplete="current-password"
            required
          />
        )}
        <PasswordField
          text={text}
          label={text.passwordChange.newPasswordLabel}
          value={newPassword}
          onChange={onNewPasswordChange}
          autoComplete="new-password"
          required
        />
        <PasswordEntropyMeter text={text} password={newPassword} />
        <p className="hint">{text.passwordChange.complexityHint}</p>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? text.passwordChange.submitting : text.passwordChange.submit}
        </button>
      </form>
      <StatusMessage message={message} />
    </section>
  );
}
