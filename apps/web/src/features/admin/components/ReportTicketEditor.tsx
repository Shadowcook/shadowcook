import { useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import type { ContentReport, ReportResult, ReportStatus, ReportUser } from '../../reports/types';
import { request } from '../../../lib/api/client';
import { reportError } from '../../reports/errors';

interface Properties {
  text: Translation;
  report: ContentReport;
  administrators: ReportUser[];
  onSaved: () => Promise<void>;
}
export default function ReportTicketEditor({
  text,
  report,
  administrators,
  onSaved,
}: Properties): JSX.Element {
  const [status, setStatus] = useState<ReportStatus>(report.status);
  const [result, setResult] = useState<ReportResult | ''>(report.result ?? '');
  const [note, setNote] = useState<string>(report.resultNote);
  const [assignee, setAssignee] = useState<string>(report.assignedAdminPublicId ?? '');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await request<void>(`/admin/reports/${report.publicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          result: status === 'CLOSED' ? result : null,
          resultNote: note,
          assignedAdminPublicId: assignee || null,
        }),
      });
      await onSaved();
      setSaved(true);
    } catch (failure: unknown) {
      setError(reportError(failure, text));
    } finally {
      setBusy(false);
    }
  }
  const unavailableAssignee: boolean =
    assignee !== '' &&
    !administrators.some((admin: ReportUser): boolean => admin.publicId === assignee);
  return (
    <form className="report-form" onSubmit={save}>
      <fieldset disabled={busy} className="report-form">
        <legend>{text.reports.dashboard}</legend>
        <label>
          {text.reports.status}
          <select
            value={status}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
              setStatus(event.currentTarget.value as ReportStatus);
              setSaved(false);
            }}
          >
            {(Object.keys(text.reports.statuses) as ReportStatus[]).map(
              (key: ReportStatus): JSX.Element => (
                <option key={key} value={key}>
                  {text.reports.statuses[key]}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {text.reports.assignee}
          <select
            value={assignee}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
              setAssignee(event.currentTarget.value);
              setSaved(false);
            }}
          >
            <option value="">{text.reports.unassigned}</option>
            {unavailableAssignee ? (
              <option value={assignee} disabled>
                {report.assignedAdminName} ({text.reports.unavailableAssignee})
              </option>
            ) : null}
            {administrators.map((admin: ReportUser): JSX.Element => (
              <option key={admin.publicId} value={admin.publicId}>
                {admin.displayName}
              </option>
            ))}
          </select>
        </label>
        {status === 'CLOSED' ? (
          <label>
            {text.reports.result}
            <select
              value={result}
              required
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                setResult(event.currentTarget.value as ReportResult | '');
                setSaved(false);
              }}
            >
              <option value="">{text.reports.noResult}</option>
              {(Object.keys(text.reports.results) as ReportResult[]).map(
                (key: ReportResult): JSX.Element => (
                  <option key={key} value={key}>
                    {text.reports.results[key]}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : null}
        <label>
          {text.reports.resultNote}
          <textarea
            value={note}
            maxLength={5000}
            rows={5}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
              setNote(event.currentTarget.value);
              setSaved(false);
            }}
          />
        </label>
        <p className="hint">{text.reports.resultHint}</p>
        <button type="submit">{text.reports.save}</button>
      </fieldset>
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">{text.reports.saved}</p> : null}
    </form>
  );
}
