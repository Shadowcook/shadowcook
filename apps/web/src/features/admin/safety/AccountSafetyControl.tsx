import { reportReferenceFromUrl } from '../reports/links';
import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request, jsonRequest } from '../../../lib/api/client';
import MessageDialog from '../../../components/MessageDialog';
import AdminIcon from '../../../components/AdminIcon';
import { safetyMessage } from './errors';
import EmailRecoveryControl from './EmailRecoveryControl';
import './account-safety.css';
export default function AccountSafetyControl({
  publicId,
  name,
  disabled,
  owned,
  text,
  onSaved,
}: {
  publicId: string;
  name: string;
  disabled: boolean;
  owned: { publicId: string; name: string }[];
  text: Translation;
  onSaved: () => void;
}): JSX.Element {
  const relatedReportPublicId: string = reportReferenceFromUrl(publicId);
  const [operation, setOperation] = useState<'status' | 'delete' | null>(null);
  const [reason, setReason] = useState<string>('');
  const [confirmation, setConfirmation] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  async function save(): Promise<void> {
    if (busy) return;
    if (
      Array.from(reason.trim()).length < 1 ||
      Array.from(reason.trim()).length > 2000 ||
      (operation === 'delete' && confirmation !== publicId)
    ) {
      setError(text.safety.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request<void>(`/admin/users/${publicId}`, {
        ...jsonRequest({
          reason: reason.trim(),
          ...(relatedReportPublicId ? { relatedReportPublicId } : {}),
          confirmed: true,
          ...(operation === 'delete' ? { confirmation } : { disabled: !disabled }),
        }),
        method: operation === 'delete' ? 'DELETE' : 'PATCH',
      });
      setOperation(null);
      setReason('');
      setConfirmation('');
      onSaved();
    } catch (failure: unknown) {
      setError(safetyMessage(failure, text));
    } finally {
      setBusy(false);
    }
  }
  const statusLabel: string = disabled ? text.safety.accountEnable : text.safety.accountDisable;
  const label: string =
    operation === 'delete'
      ? text.safety.accountDelete
      : disabled
        ? text.safety.accountEnable
        : text.safety.accountDisable;
  return (
    <>
      <button
        type="button"
        aria-label={statusLabel}
        title={statusLabel}
        onClick={(): void => {
          setOperation('status');
          setError('');
        }}
      >
        <AdminIcon name={disabled ? 'enable' : 'disable'} />
      </button>
      <button
        type="button"
        aria-label={text.safety.accountDelete}
        title={text.safety.accountDelete}
        onClick={(): void => {
          setOperation('delete');
          setError('');
        }}
      >
        <AdminIcon name="delete" />
      </button>
      <EmailRecoveryControl
        publicId={publicId}
        name={name}
        text={text}
        onSaved={onSaved}
        relatedReportPublicId={relatedReportPublicId}
      />
      {operation ? (
        <MessageDialog
          kind="confirmation"
          text={text.dialog}
          title={label}
          message={operation === 'delete' ? text.safety.ownership : text.safety.accountScope}
          busy={busy}
          onClose={(): void => {
            setOperation(null);
            setReason('');
            setConfirmation('');
          }}
          onConfirm={(): void => {
            void save();
          }}
          confirmLabel={label}
        >
          <p>
            {name} · {publicId}
          </p>
          {relatedReportPublicId ? (
            <p>
              {text.inspection.report}: {relatedReportPublicId}
            </p>
          ) : null}
          <label>
            {text.safety.reason}
            <textarea
              value={reason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReason(event.currentTarget.value)
              }
            />
          </label>
          {operation === 'delete' ? (
            <>
              <ul>
                {owned.map((book: { publicId: string; name: string }): JSX.Element => (
                  <li key={book.publicId}>
                    <a
                      className="account-safety__cookbook-link"
                      href={`/admin/tenants/${book.publicId}/inspection`}
                    >
                      {book.name} · {book.publicId}
                    </a>
                  </li>
                ))}
              </ul>
              <label>
                {text.safety.confirmation}
                <input
                  value={confirmation}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setConfirmation(event.currentTarget.value)
                  }
                />
              </label>
            </>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </MessageDialog>
      ) : null}
    </>
  );
}
