import { useId, useRef, useState } from 'react';
import type { ChangeEvent, JSX, RefObject, SubmitEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFlag } from '@fortawesome/free-solid-svg-icons';
import Dialog from '../../components/Dialog';
import type { Translation } from '../../i18n';
import { jsonRequest, request } from '../../lib/api/client';
import { reportError } from './errors';
import type { ReportReason, ReportTargetType } from './types';

interface Properties {
  text: Translation;
  targetType: ReportTargetType;
  targetPublicId: string;
  targetName?: string;
  shareToken?: string;
}

export default function ReportButton(properties: Properties): JSX.Element {
  const { text } = properties;
  const formId: string = useId();
  const reasonRef: RefObject<HTMLSelectElement | null> = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [reason, setReason] = useState<ReportReason>('ILLEGAL_CONTENT');
  const [description, setDescription] = useState<string>('');
  const labels: Record<ReportTargetType, string> = {
    RECIPE: text.reports.reportRecipe,
    COOKBOOK: text.reports.reportCookbook,
    USER: text.reports.reportUser,
  };

  function show(): void {
    setOpen(true);
    setSubmitted(false);
    setDescription('');
    setReason('ILLEGAL_CONTENT');
    setError('');
  }
  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request<{ publicId: string }>(
        '/reports',
        jsonRequest({
          targetType: properties.targetType,
          targetPublicId: properties.targetPublicId,
          reason,
          description,
          ...(properties.shareToken === undefined ? {} : { shareToken: properties.shareToken }),
        }),
      );
      setSubmitted(true);
    } catch (failure: unknown) {
      setError(reportError(failure, text));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="content-actions__item" onClick={show}>
        <FontAwesomeIcon icon={faFlag} aria-hidden="true" />
        {labels[properties.targetType]}
      </button>
      {open ? (
        <Dialog
          kind="information"
          title={text.reports.title}
          message={submitted ? text.reports.submitted : text.reports.introduction}
          icon={<FontAwesomeIcon icon={faFlag} className="application-dialog__icon" />}
          busy={busy}
          initialFocusRef={reasonRef}
          onClose={(): void => setOpen(false)}
          actions={
            submitted ? (
              <button type="button" onClick={(): void => setOpen(false)}>
                {text.dialog.acknowledge}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button--secondary"
                  disabled={busy}
                  onClick={(): void => setOpen(false)}
                >
                  {text.dialog.cancel}
                </button>
                <button type="submit" form={formId} disabled={busy}>
                  {busy ? text.reports.submitting : text.reports.submit}
                </button>
              </>
            )
          }
        >
          {submitted ? null : (
            <form id={formId} className="report-form" onSubmit={submit}>
              {properties.targetName ? <p>{properties.targetName}</p> : null}
              <label>
                {text.reports.reason}
                <select
                  ref={reasonRef}
                  value={reason}
                  disabled={busy}
                  required
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                    setReason(event.currentTarget.value as ReportReason)
                  }
                >
                  {(Object.keys(text.reports.reasons) as ReportReason[]).map(
                    (key: ReportReason): JSX.Element => (
                      <option key={key} value={key}>
                        {text.reports.reasons[key]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {text.reports.description}
                <textarea
                  value={description}
                  required
                  maxLength={5000}
                  rows={6}
                  disabled={busy}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                    setDescription(event.currentTarget.value)
                  }
                />
              </label>
            </form>
          )}
          {error ? (
            <p className="message" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
