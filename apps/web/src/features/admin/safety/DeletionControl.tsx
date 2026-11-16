import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request, jsonRequest } from '../../../lib/api/client';
import MessageDialog from '../../../components/MessageDialog';
import AdminIcon from '../../../components/AdminIcon';
import { safetyMessage } from './errors';
interface Scope {
  recipeCount: number;
  revisionCount: number;
  shareCount: number;
  mediaCount: number;
  memberCount: number;
}
export default function DeletionControl({
  tenantId,
  relatedReportPublicId,
  recipeId,
  name,
  text,
  compact = false,
  onDeleted,
}: {
  tenantId: string;
  relatedReportPublicId?: string;
  recipeId?: string;
  name: string;
  text: Translation;
  compact?: boolean;
  onDeleted: () => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>('');
  const [userReason, setUserReason] = useState<string>('');
  const [scope, setScope] = useState<Scope | null>(null);
  const [confirmation, setConfirmation] = useState<string>('');
  const [reviewed, setReviewed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const path: string = `/admin/tenants/${tenantId}${recipeId ? `/recipes/${recipeId}` : ''}`;
  const target: string = recipeId ?? tenantId;
  async function act(): Promise<void> {
    if (busy) return;
    if (Array.from(userReason.trim()).length > 2000) {
      setError(text.safety.invalidUserReason);
      return;
    }
    if (Array.from(reason.trim()).length < 1 || Array.from(reason.trim()).length > 2000) {
      setError(text.safety.invalidAdministrativeReason);
      return;
    }
    if (scope && !reviewed) {
      setError(text.safety.preservationRequired);
      return;
    }
    if (scope && confirmation !== target) {
      setError(text.safety.invalidConfirmation);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!scope)
        setScope(
          await request<Scope>(
            `${path}/deletion-preview`,
            jsonRequest({
              reason: reason.trim(),
              ...(relatedReportPublicId ? { relatedReportPublicId } : {}),
            }),
          ),
        );
      else {
        await request<void>(path, {
          ...jsonRequest({
            reason: reason.trim(),
            ...(userReason.trim() ? { userReason: userReason.trim() } : {}),
            ...(relatedReportPublicId ? { relatedReportPublicId } : {}),
            confirmation,
            preservationReviewed: reviewed,
            expectedScope: scope,
          }),
          method: 'DELETE',
        });
        setOpen(false);
        onDeleted();
      }
    } catch (failure: unknown) {
      setError(safetyMessage(failure, text));
      setScope(null);
      setConfirmation('');
      setReviewed(false);
    } finally {
      setBusy(false);
    }
  }
  function close(): void {
    setOpen(false);
    setScope(null);
    setReason('');
    setUserReason('');
    setConfirmation('');
    setReviewed(false);
    setError('');
  }
  return (
    <>
      <button
        type="button"
        aria-label={text.safety.deletion}
        title={text.safety.deletion}
        onClick={(): void => setOpen(true)}
      >
        {compact ? <AdminIcon name="delete" /> : text.safety.deletion}
      </button>
      {open ? (
        <MessageDialog
          kind="confirmation"
          text={text.dialog}
          title={text.safety.deletion}
          message={text.safety.irreversible}
          busy={busy}
          confirmLabel={scope ? text.safety.deletion : text.safety.review}
          onClose={close}
          onConfirm={(): void => {
            void act();
          }}
        >
          <p>
            {name} · {target}
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
          <p>{text.safety.deletionNotification}</p>
          <label>
            {text.moderation.optionalUserReason}
            <textarea
              value={userReason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setUserReason(event.currentTarget.value)
              }
            />
            <span>{text.moderation.userReasonHelp}</span>
          </label>
          {scope ? (
            <>
              <dl>
                {Object.entries(scope).map(([key, count]: [string, number]): JSX.Element => (
                  <div key={key}>
                    <dt>{text.safety.counts[key]}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    setReviewed(event.currentTarget.checked)
                  }
                />
                {text.safety.preservation}
              </label>
              <label className="deletion-dialog__confirmation">
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
