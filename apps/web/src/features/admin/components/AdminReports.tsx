import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { translations, type Locale, type Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import { reportError } from '../../reports/errors';
import type { ContentReport, ReportStatus, ReportUser } from '../../reports/types';
import ReportTicketEditor from './ReportTicketEditor';

interface ReportList {
  reports: ContentReport[];
  administrators: ReportUser[];
  page: number;
  pageSize: number;
  totalReports: number;
}
interface ReportDetail {
  report: ContentReport;
  administrators: ReportUser[];
}

export default function AdminReports({
  locale,
  publicId,
}: {
  locale: Locale;
  publicId?: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const [page, setPage] = useState<number>(1);
  const [list, setList] = useState<ReportList | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  useEffect((): (() => void) => {
    let active: boolean = true;
    setLoading(true);
    setError('');
    const path: string = publicId
      ? `/admin/reports/${encodeURIComponent(publicId)}`
      : `/admin/reports?page=${page}${status ? `&status=${status}` : ''}`;
    void request<ReportList | ReportDetail>(path)
      .then((response: ReportList | ReportDetail): void => {
        if (!active) return;
        if ('report' in response) setDetail(response);
        else setList(response);
      })
      .catch((failure: unknown): void => {
        if (active) setError(reportError(failure, text));
      })
      .finally((): void => {
        if (active) setLoading(false);
      });
    return (): void => {
      active = false;
    };
  }, [publicId, page, status, text]);
  async function reloadDetail(): Promise<void> {
    const response: ReportDetail = await request<ReportDetail>(
      `/admin/reports/${encodeURIComponent(publicId ?? '')}`,
    );
    setDetail(response);
  }
  function timestamp(value: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }
  return (
    <section
      className={
        publicId ? 'admin-page admin-page--wide report-detail' : 'admin-page admin-page--wide'
      }
    >
      <h1>{text.reports.dashboard}</h1>
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      {publicId ? (
        <>
          <a className="button--secondary report-detail__back" href="/admin/reports">
            {text.reports.back}
          </a>
          {loading ? (
            <p aria-live="polite">{text.loading}</p>
          ) : detail ? (
            <>
              <h2 className="report-detail__title">
                {text.reports.targets[detail.report.targetType]}:{' '}
                {detail.report.targetName ?? detail.report.targetPublicId}
              </h2>
              <p className="hint">{detail.report.publicId}</p>
              <dl className="report-details">
                <dt>{text.reports.target}</dt>
                <dd>
                  {detail.report.targetUrl ? (
                    <a href={detail.report.targetUrl}>
                      {detail.report.targetName ?? detail.report.targetPublicId}
                    </a>
                  ) : (
                    detail.report.targetPublicId
                  )}
                </dd>
                <dt>{text.reports.reporter}</dt>
                <dd>
                  {detail.report.reporterName} ({detail.report.reporterEmail})
                </dd>
                <dt>{text.reports.reason}</dt>
                <dd>{text.reports.reasons[detail.report.reason]}</dd>
                <dt>{text.reports.createdAt}</dt>
                <dd>{timestamp(detail.report.createdAt)}</dd>
                <dt>{text.reports.updatedAt}</dt>
                <dd>{timestamp(detail.report.updatedAt)}</dd>
                <dt>{text.reports.notification}</dt>
                <dd>
                  {detail.report.notificationSentAt
                    ? text.reports.notificationSent
                    : text.reports.notificationPending}
                </dd>
              </dl>
              <h3>{text.reports.description}</h3>
              <p className="report-description">{detail.report.description}</p>
              <ReportTicketEditor
                key={detail.report.publicId}
                text={text}
                report={detail.report}
                administrators={detail.administrators}
                onSaved={reloadDetail}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <label className="report-filter">
            {text.reports.status}
            <select
              value={status}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                setStatus(event.currentTarget.value as ReportStatus | '');
                setPage(1);
              }}
            >
              <option value="">{text.reports.allStatuses}</option>
              {(Object.keys(text.reports.statuses) as ReportStatus[]).map(
                (key: ReportStatus): JSX.Element => (
                  <option key={key} value={key}>
                    {text.reports.statuses[key]}
                  </option>
                ),
              )}
            </select>
          </label>
          {loading ? (
            <p aria-live="polite">{text.loading}</p>
          ) : list && list.reports.length > 0 ? (
            <div
              className="report-table-container"
              role="region"
              aria-label={text.reports.dashboard}
              tabIndex={0}
            >
              <table className="tenant-table report-table">
                <thead>
                  <tr>
                    <th>{text.reports.target}</th>
                    <th>{text.reports.reason}</th>
                    <th>{text.reports.status}</th>
                    <th>{text.reports.result}</th>
                    <th>{text.reports.assignee}</th>
                    <th>{text.reports.createdAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.reports.map((report: ContentReport): JSX.Element => (
                    <tr key={report.publicId}>
                      <td>
                        <a href={`/admin/reports/${report.publicId}`}>
                          {text.reports.targets[report.targetType]}:{' '}
                          {report.targetName ?? report.targetPublicId}
                        </a>
                      </td>
                      <td>{text.reports.reasons[report.reason]}</td>
                      <td>{text.reports.statuses[report.status]}</td>
                      <td>
                        {report.result
                          ? text.reports.results[report.result]
                          : text.reports.noResult}
                      </td>
                      <td>{report.assignedAdminName ?? text.reports.unassigned}</td>
                      <td>{timestamp(report.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{text.reports.empty}</p>
          )}
          {list && list.totalReports > list.pageSize ? (
            <nav className="report-pagination" aria-label={text.reports.dashboard}>
              <button
                type="button"
                disabled={loading || page === 1}
                onClick={(): void => setPage(page - 1)}
              >
                {text.reports.previous}
              </button>
              <span>
                {page} / {Math.ceil(list.totalReports / list.pageSize)}
              </span>
              <button
                type="button"
                disabled={loading || page * list.pageSize >= list.totalReports}
                onClick={(): void => setPage(page + 1)}
              >
                {text.reports.next}
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
