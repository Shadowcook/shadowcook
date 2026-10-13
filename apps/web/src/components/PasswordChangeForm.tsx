import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import StatusMessage from './StatusMessage';
import PasswordEntropyMeter from './PasswordEntropyMeter';
import PasswordField from './PasswordField';

export interface PasswordChangeFormProperties {
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

export default function PasswordChangeForm({
  text,
  hasPassword,
  currentPassword,
  newPassword,
  isSubmitting,
  message,
  onSubmit,
  onCurrentPasswordChange,
  onNewPasswordChange,
}: PasswordChangeFormProperties): JSX.Element {
  return (
    <>
      <form onSubmit={onSubmit}>
        <fieldset className="password-change-form__fields" disabled={isSubmitting}>
          <legend className="password-change-form__legend">{text.passwordChange.title}</legend>
          {hasPassword ? (
            <PasswordField
              text={text}
              label={text.passwordChange.currentPasswordLabel}
              value={currentPassword}
              onChange={onCurrentPasswordChange}
              autoComplete="current-password"
              required
            />
          ) : null}
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
          <button
            type="submit"
            disabled={
              isSubmitting ||
              newPassword.length === 0 ||
              (hasPassword && currentPassword.length === 0)
            }
          >
            {isSubmitting ? text.passwordChange.submitting : text.passwordChange.submit}
          </button>
        </fieldset>
      </form>
      <StatusMessage message={message} />
    </>
  );
}
