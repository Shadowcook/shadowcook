import { reportLink } from './links';
import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Locale, Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import { request, jsonRequest } from '../../../lib/api/client';
import type { ReportHistory as History } from './types';

function initialPage(): number {
  if (typeof window === 'undefined') return 1;
  const page: number = Number(new URLSearchParams(window.location.search).get('historyPage') ?? 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}
export default function ReportHistory({
  reportId,
  text,
  locale,
}: {
  reportId: string;
  text: Translation;
  locale: Locale;
}): JSX.Element {
  const [reason, setReason] = useState<string>('');
  const [eventId, setEventId] = useState<string>('');
  const [review, setReview] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [history, setHistory] = useState<History | null>(null);
  useEffect((): void => {
    if (!history || !/^#(?:event|notice)-[0-9a-f-]{36}$/i.test(window.location.hash)) return;
    const entry: HTMLElement | null = document.getElementById(window.location.hash.slice(1));
    entry?.focus({ preventScroll: true });
    entry?.scrollIntoView({ block: 'nearest' });
  }, [history]);
  async function load(page: number): Promise<void> {
    if (busy) return;
    if (!reason.trim() || Array.from(reason.trim()).length > 2000) {
      setError(text.workflow.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result: History = await request(
        `/admin/reports/${reportId}/history`,
        jsonRequest({ reason: reason.trim(), page }),
      );
      setHistory(result);
      const url: URL = new URL(window.location.href);
      url.searchParams.set('historyPage', String(page));
      if (history) url.hash = '';
      window.history.replaceState({}, '', url);
    } catch {
      setHistory(null);
      setError(text.workflow.failed);
    } finally {
      setBusy(false);
    }
  }
  async function link(): Promise<void> {
    if (busy) return;
    if (
      !reason.trim() ||
      Array.from(reason.trim()).length > 2000 ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId.trim())
    ) {
      setError(text.workflow.invalid);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(
        `/admin/reports/${reportId}/events`,
        jsonRequest({ reason: reason.trim(), confirmed: true, auditEventPublicId: eventId.trim() }),
      );
      setReview(false);
      setEventId('');
      setHistory(null);
      setMessage(text.workflow.linked);
    } catch {
      setError(text.workflow.failed);
    } finally {
      setBusy(false);
    }
  }
  function timestamp(value: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }
  const pageCount: number = history
    ? Math.max(1, Math.ceil(Math.max(history.totalEvents, history.totalNotices) / history.pageSize))
    : 1;
  return (
    <section className="report-history">
      <h3>{text.workflow.history}</h3>
      <p>{text.workflow.historyHint}</p>
      <form
        className="report-form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => {
          event.preventDefault();
          void load(history?.page ?? initialPage());
        }}
      >
        <label>
          {text.workflow.historyPurpose}
          <textarea
            value={reason}
            aria-required="true"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setReason(event.currentTarget.value)
            }
          />
        </label>
        <button disabled={busy} type="submit">
          {text.workflow.loadHistory}
        </button>
      </form>
      <p>{text.workflow.linkHint}</p>
      <button
        disabled={busy}
        type="button"
        onClick={(): void => {
          setReview(true);
          setError('');
        }}
      >
        {text.workflow.linkEvent}
      </button>
      {review ? (
        <MessageDialog
          kind="confirmation"
          title={text.workflow.linkEvent}
          text={text.dialog}
          message={text.workflow.linkHint}
          busy={busy}
          onClose={(): void => setReview(false)}
          onConfirm={(): void => {
            void link();
          }}
        >
          <label>
            {text.workflow.historyPurpose}
            <textarea
              value={reason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReason(event.currentTarget.value)
              }
            />
          </label>
          <label>
            {text.workflow.eventId}
            <input
              value={eventId}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setEventId(event.currentTarget.value)
              }
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
        </MessageDialog>
      ) : null}
      {error && !review ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {busy ? <p role="status">{text.loading}</p> : null}
      {history ? (
        <>
          {history.events.length === 0 ? <p>{text.workflow.empty}</p> : null}
          {history.events.map((event: History['events'][number]): JSX.Element => (
            <article tabIndex={-1} key={event.publicId} id={`event-${event.publicId}`}>
              <h4>{text.workflow.actions[event.action] ?? text.workflow.action}</h4>
              {event.recheckPath ? (
                <p>
                  <a href={reportLink(event.recheckPath, reportId)}>{text.workflow.refresh}</a>
                </p>
              ) : null}
              <a href={`?historyPage=${history.page}#event-${event.publicId}`}>{event.publicId}</a>{' '}
              · <time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time>
              <dl>
                <dt>{text.workflow.action}</dt>
                <dd>
                  <code>{event.action}</code>
                </dd>
                <dt>{text.reports.target}</dt>
                <dd>{event.targetPublicId}</dd>
                <dt>{text.workflow.actor}</dt>
                <dd>{event.actorPrincipalId}</dd>
                <dt>{text.workflow.requestId}</dt>
                <dd>{event.requestId}</dd>
                <dt>{text.safety.reason}</dt>
                <dd className="report-description">
                  {event.reason === 'REPORT_WORKFLOW_UPDATE'
                    ? text.workflow.workflowUpdate
                    : event.reason}
                </dd>
              </dl>
              {event.previousState ? (
                <details>
                  <summary>{text.workflow.before}</summary>
                  <pre>{JSON.stringify(event.previousState, null, 2)}</pre>
                </details>
              ) : null}
              {event.newState ? (
                <details>
                  <summary>{text.workflow.after}</summary>
                  <pre>{JSON.stringify(event.newState, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          ))}
          <h4>{text.workflow.notices}</h4>
          {history.notices.length === 0 ? <p>{text.workflow.empty}</p> : null}
          {history.notices.map((notice: History['notices'][number]): JSX.Element => (
            <article tabIndex={-1} key={notice.publicId} id={`notice-${notice.publicId}`}>
              <a href={`?historyPage=${history.page}#notice-${notice.publicId}`}>
                {notice.publicId}
              </a>{' '}
              · <time dateTime={notice.createdAt}>{timestamp(notice.createdAt)}</time>
              <p>
                {text.workflow.roles[notice.recipientRole]} · {notice.recipientPublicId} ·{' '}
                {text.workflow.delivery[notice.deliveryStatus]}
              </p>
              <p className="report-description">{notice.message}</p>
              <p className="report-description">{notice.reviewInstructions}</p>
            </article>
          ))}
          <nav aria-label={text.workflow.history}>
            <button
              disabled={busy || history.page <= 1}
              type="button"
              onClick={(): void => {
                void load(history.page - 1);
              }}
            >
              {text.reports.previous}
            </button>
            <span>
              {history.page} / {pageCount}
            </span>
            <button
              disabled={busy || history.page >= pageCount}
              type="button"
              onClick={(): void => {
                void load(history.page + 1);
              }}
            >
              {text.reports.next}
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
