import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX, RefObject, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import PasswordChangeForm from './PasswordChangeForm';

interface AccountPasswordSettingsProperties {
  text: Translation;
  hasPassword: boolean;
  onPasswordChanged: () => void;
}

export default function AccountPasswordSettings({
  text,
  hasPassword,
  onPasswordChanged,
}: AccountPasswordSettingsProperties): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [completed, setCompleted] = useState<boolean>(false);
  const backLinkRef: RefObject<HTMLAnchorElement | null> = useRef<HTMLAnchorElement>(null);

  useEffect((): void => {
    if (completed) backLinkRef.current?.focus();
  }, [completed]);

  async function changePassword(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      completed ||
      submitting ||
      newPassword.length === 0 ||
      (hasPassword && currentPassword.length === 0)
    )
      return;
    setSubmitting(true);
    setMessage('');
    try {
      await request<void>(
        '/auth/change-password',
        jsonRequest({
          ...(hasPassword ? { currentPassword } : {}),
          newPassword,
        }),
      );
      setCurrentPassword('');
      setNewPassword('');
      clearBrowserSessionCache();
      onPasswordChanged();
      setCompleted(true);
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiRequestError && error.code === 'AUTHENTICATION_FAILED'
          ? text.accountPassword.authenticationFailed
          : error instanceof ApiRequestError && error.code === 'AUTHENTICATION_REQUIRED'
            ? text.accountSettings.signInRequired
            : error instanceof ApiRequestError && error.code === 'INVALID_PASSWORD'
              ? text.accountPassword.invalidPassword
              : text.errors.requestFailed,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="account-password-settings">
      {completed ? (
        <div role="status">
          <h2>{text.accountPassword.successTitle}</h2>
          <p className="lede">{text.accountPassword.saved}</p>
        </div>
      ) : (
        <>
          <h2>{text.accountPassword.title}</h2>
          <p className="lede">
            {hasPassword
              ? text.accountPassword.description
              : text.accountPassword.firstPasswordDescription}
          </p>
          <PasswordChangeForm
            text={text}
            hasPassword={hasPassword}
            currentPassword={currentPassword}
            newPassword={newPassword}
            isSubmitting={submitting}
            message={message}
            onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void changePassword(event)}
            onCurrentPasswordChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setCurrentPassword(event.currentTarget.value)
            }
            onNewPasswordChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setNewPassword(event.currentTarget.value)
            }
          />
        </>
      )}
      <a ref={backLinkRef} className="button-link" href="/settings/profile">
        {text.accountPassword.back}
      </a>
    </section>
  );
}
