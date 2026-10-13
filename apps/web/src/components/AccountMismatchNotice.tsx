import { useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from '../lib/api/client';
import { clearBrowserSessionCache } from '../lib/browser/session-cache';
import StatusMessage from './StatusMessage';

interface AccountMismatchNoticeProperties {
  text: Translation;
  returnPath: string;
}

export default function AccountMismatchNotice({
  text,
  returnPath,
}: AccountMismatchNoticeProperties): JSX.Element {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  async function signOutAndContinue(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      await request<void>('/auth/logout', { method: 'POST' });
      clearBrowserSessionCache();
      window.location.assign(returnPath);
    } catch (_error: unknown) {
      setMessage(text.headBar.signOutFailed);
      setSubmitting(false);
    }
  }

  return (
    <>
      <StatusMessage message={text.accountLink.mismatch} />
      <div className="account-link-actions">
        <button type="button" disabled={submitting} onClick={(): void => void signOutAndContinue()}>
          {text.accountLink.signOutAndContinue}
        </button>
      </div>
      <StatusMessage message={message} />
    </>
  );
}
