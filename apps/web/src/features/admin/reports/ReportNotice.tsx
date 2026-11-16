import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import { request, jsonRequest } from '../../../lib/api/client';
import type { ReportContext } from './types';

export default function ReportNotice({
  reportId,
  context,
  text,
}: {
  reportId: string;
  context: ReportContext;
  text: Translation;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [role, setRole] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [outcome, setOutcome] = useState<string>('');
  const recipient: ReportContext['recipients'][number] | undefined = context.recipients.find(
    (candidate: ReportContext['recipients'][number]): boolean => candidate.role === role,
  );
  async function send(): Promise<void> {
    if (busy) return;
    if (
      !recipient ||
      !reason.trim() ||
      Array.from(reason.trim()).length > 2000 ||
      !message.trim() ||
      Array.from(message).length > 5000 ||
      !instructions.trim() ||
      Array.from(instructions).length > 2000
    ) {
      setError(text.workflow.invalid);
      return;
    }
    setBusy(true);
    setError('');
    setOutcome('');
    try {
      const result: { noticePublicId: string; deliveryStatus: 'SENT' | 'FAILED' } = await request(
        `/admin/reports/${reportId}/notices`,
        jsonRequest({
          reason: reason.trim(),
          confirmed: true,
          recipientRole: role,
          expectedRecipientPublicId: recipient.publicId,
          message: message.trim(),
          reviewInstructions: instructions.trim(),
        }),
      );
      setOutcome(
        result.deliveryStatus === 'SENT' ? text.workflow.noticeSent : text.workflow.noticeFailed,
      );
      setOpen(false);
      setMessage('');
      setInstructions('');
      setReason('');
      setRole('');
    } catch {
      setError(text.workflow.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="report-form">
      <h3>{text.workflow.notice}</h3>
      <p>{text.workflow.noticeHint}</p>
      <button
        type="button"
        disabled={context.recipients.length === 0}
        onClick={(): void => {
          setOpen(true);
          setError('');
        }}
      >
        {text.workflow.notice}
      </button>
      {outcome ? <p role="status">{outcome}</p> : null}
      {open ? (
        <MessageDialog
          kind="confirmation"
          title={text.workflow.notice}
          text={text.dialog}
          message={text.workflow.noticeConfirmation}
          confirmLabel={text.workflow.notice}
          busy={busy}
          onConfirm={(): void => {
            void send();
          }}
          onClose={(): void => {
            setOpen(false);
            setMessage('');
            setInstructions('');
            setReason('');
            setRole('');
          }}
        >
          <label>
            {text.workflow.recipient}
            <select
              value={role}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setRole(event.currentTarget.value)
              }
            >
              <option value="">{text.workflow.recipient}</option>
              {context.recipients.map((item: ReportContext['recipients'][number]): JSX.Element => (
                <option value={item.role} key={item.role}>
                  {text.workflow.roles[item.role]} · {item.displayName} · {item.publicId}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text.safety.reason}
            <textarea
              value={reason}
              aria-required="true"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReason(event.currentTarget.value)
              }
            />
          </label>
          <label>
            {text.workflow.publicMessage}
            <textarea
              value={message}
              aria-required="true"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setMessage(event.currentTarget.value)
              }
            />
          </label>
          <label>
            {text.workflow.reviewInstructions}
            <textarea
              value={instructions}
              aria-required="true"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setInstructions(event.currentTarget.value)
              }
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
        </MessageDialog>
      ) : null}
    </section>
  );
}
