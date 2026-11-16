import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import AdminIcon from '../../../components/AdminIcon';
import { request } from '../../../lib/api/client';
import './moderation.css';
export default function ModerationControl({
  tenantId,
  initialReportPublicId = '',
  recipeId,
  blocked,
  name,
  text,
  compact = false,
  onSaved,
}: {
  tenantId: string;
  initialReportPublicId?: string;
  recipeId?: string;
  blocked: boolean;
  name: string;
  text: Translation;
  compact?: boolean;
  onSaved: () => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>('');
  const [userReason, setUserReason] = useState<string>('');
  const [report, setReport] = useState<string>(initialReportPublicId);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const label: string = blocked ? text.moderation.unblock : text.moderation.block;
  async function save(): Promise<void> {
    if (busy) return;
    if (
      (!blocked && userReason.trim().length === 0) ||
      Array.from(userReason.trim()).length > 2000
    ) {
      setError(text.moderation.invalidUserReason);
      return;
    }
    if (
      Array.from(reason.trim()).length < 1 ||
      Array.from(reason.trim()).length > 2000 ||
      (report.trim() !== '' &&
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report.trim()))
    ) {
      setError(text.moderation.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request<void>(
        `/admin/tenants/${tenantId}${recipeId ? `/recipes/${recipeId}/moderation` : ''}`,
        {
          method: recipeId ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [recipeId ? 'blocked' : 'disabled']: !blocked,
            confirmed: true,
            reason: reason.trim(),
            ...(userReason.trim() ? { userReason: userReason.trim() } : {}),
            ...(report.trim() ? { relatedReportPublicId: report.trim() } : {}),
          }),
        },
      );
      setOpen(false);
      setReason('');
      setUserReason('');
      setReport(initialReportPublicId);
      onSaved();
    } catch {
      setError(text.moderation.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(): void => {
          setError('');
          setOpen(true);
        }}
      >
        {compact ? <AdminIcon name={blocked ? 'unblock' : 'block'} /> : label}
      </button>
      {open ? (
        <MessageDialog
          className="moderation-dialog"
          kind="confirmation"
          title={label}
          text={text.dialog}
          message={text.moderation.explanation}
          busy={busy}
          confirmLabel={label}
          onClose={(): void => {
            setOpen(false);
            setReason('');
            setUserReason('');
            setReport(initialReportPublicId);
          }}
          onConfirm={(): void => {
            void save();
          }}
        >
          <div className="moderation-dialog__fields">
            <p className="moderation-dialog__name">{name}</p>
            <p>
              {blocked
                ? text.moderation.liftNotification
                : recipeId
                  ? text.moderation.recipeNotification
                  : text.moderation.cookbookNotification}
            </p>
            <label>
              {text.moderation.reason}
              <textarea
                aria-required="true"
                value={reason}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setReason(event.currentTarget.value)
                }
              />
            </label>
            <label>
              {blocked ? text.moderation.optionalUserReason : text.moderation.userReason}
              <textarea
                aria-required={!blocked}
                value={userReason}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  setUserReason(event.currentTarget.value)
                }
              />
              <span>{text.moderation.userReasonHelp}</span>
            </label>
            <label>
              {text.moderation.report}
              <input
                value={report}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setReport(event.currentTarget.value)
                }
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
          </div>
        </MessageDialog>
      ) : null}
    </>
  );
}
