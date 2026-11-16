import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request, jsonRequest } from '../../../lib/api/client';
import MessageDialog from '../../../components/MessageDialog';
import AdminIcon from '../../../components/AdminIcon';
import { safetyMessage } from './errors';
import './email-recovery.css';
interface Delivery {
  recipient: string;
  status: string;
}
export default function EmailRecoveryControl({
  publicId,
  relatedReportPublicId,
  name,
  text,
  onSaved,
}: {
  publicId: string;
  relatedReportPublicId?: string;
  name: string;
  text: Translation;
  onSaved: () => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  async function act(): Promise<void> {
    if (busy) return;
    if (
      Array.from(reason.trim()).length < 1 ||
      Array.from(reason.trim()).length > 2000 ||
      !email.trim()
    ) {
      setError(text.safety.invalid);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result: { deliveries: Delivery[] } = await request(
        `/admin/users/${publicId}/email-recovery`,
        jsonRequest({
          email: email.trim(),
          reason: reason.trim(),
          ...(relatedReportPublicId ? { relatedReportPublicId } : {}),
          confirmed: true,
        }),
      );
      setMessage(
        result.deliveries.every((item: Delivery): boolean => item.status === 'SENT')
          ? text.safety.recoveryPending
          : text.safety.failedMail,
      );
      onSaved();
    } catch (failure: unknown) {
      setError(safetyMessage(failure, text));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        aria-label={text.safety.recovery}
        title={text.safety.recovery}
        onClick={(): void => setOpen(true)}
      >
        <AdminIcon name="emailRecovery" />
      </button>
      {open ? (
        <MessageDialog
          className="email-recovery-dialog"
          kind="confirmation"
          text={text.dialog}
          title={text.safety.recovery}
          message={text.safety.verified}
          busy={busy}
          onClose={(): void => {
            setOpen(false);
            setEmail('');
            setReason('');
            setError('');
            setMessage('');
          }}
          onConfirm={(): void => {
            void act();
          }}
          confirmLabel={text.safety.proof}
        >
          <div className="email-recovery-dialog__body">
            <div className="email-recovery-dialog__account">
              <p className="email-recovery-dialog__account-name">{name}</p>
              <p className="email-recovery-dialog__account-id">{publicId}</p>
              {relatedReportPublicId ? (
                <p>
                  {text.inspection.report}: {relatedReportPublicId}
                </p>
              ) : null}
            </div>
            <label>
              {text.safety.reason}
              <textarea
                rows={4}
                value={reason}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setReason(event.currentTarget.value)
                }
              />
            </label>
            <div className="email-recovery-dialog__verification">
              <div className="email-recovery-dialog__destination">
                <label>
                  {text.safety.email}
                  <input
                    type="email"
                    value={email}
                    onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                      setEmail(event.currentTarget.value);
                    }}
                  />
                </label>
              </div>
            </div>
            {message ? (
              <p className="email-recovery-dialog__status" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="email-recovery-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </MessageDialog>
      ) : null}
    </>
  );
}
