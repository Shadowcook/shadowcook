import './inspection.css';
import InspectionBrowser from './InspectionBrowser';
import { reportReferenceFromUrl, reportLink } from '../reports/links';
import InspectionActions from './InspectionActions';
import type { OwnershipResponse } from '../ownership/OwnershipTransfer';
import { useEffect, useState } from 'react';
import type { JSX, SubmitEvent, MouseEvent, ChangeEvent } from 'react';
import { translations, type Locale, type Translation } from '../../../i18n';
import { request, jsonRequest, ApiRequestError } from '../../../lib/api/client';
import type { InspectionOverview } from './types';

export default function AdminInspection({
  locale,
  path,
}: {
  locale: Locale;
  path: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const labels: Translation['inspection'] = text.inspection;
  const [transferResult, setTransferResult] = useState<OwnershipResponse | null>(null);
  const [reason, setReason] = useState<string>('');
  const [report, setReport] = useState<string>(() => reportReferenceFromUrl());
  const [purpose, setPurpose] = useState<object | null>(null);
  const [overview, setOverview] = useState<InspectionOverview | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(path);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const tenantPath: string = path.split('/').slice(0, 4).join('/');
  useEffect((): (() => void) => {
    const pop: () => void = (): void => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', pop);
    return (): void => window.removeEventListener('popstate', pop);
  }, []);
  useEffect((): (() => void) => {
    let active: boolean = true;
    const controller: AbortController = new AbortController();
    setOverview(null);
    setError('');
    if (purpose === null) {
      setBusy(false);
      return (): void => controller.abort();
    }
    setBusy(true);
    async function load(): Promise<void> {
      try {
        const base: string = `${tenantPath}/inspection`;
        const loaded: InspectionOverview = await request<InspectionOverview>(base, {
          ...jsonRequest(purpose!),
          signal: controller.signal,
        });
        if (!active) return;
        setOverview(loaded);
      } catch (failure: unknown) {
        if (active) {
          setOverview(null);
          setError(
            failure instanceof ApiRequestError
              ? failure.status === 403 || failure.status === 401
                ? labels.denied
                : failure.status === 400
                  ? labels.invalidPurpose
                  : failure.status === 404
                    ? labels.missing
                    : labels.error
              : labels.error,
          );
        }
      } finally {
        if (active) setBusy(false);
      }
    }
    void load();
    return (): void => {
      active = false;
      controller.abort();
    };
  }, [tenantPath, purpose, labels]);
  function navigate(event: MouseEvent<HTMLAnchorElement>, target: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    window.history.pushState({}, '', reportLink(target, report));
    setCurrentPath(target.split('#')[0]!);
  }
  function enter(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      Array.from(reason.trim()).length < 1 ||
      Array.from(reason.trim()).length > 2000 ||
      (report.trim() !== '' &&
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report.trim()))
    ) {
      setError(labels.invalidPurpose);
      return;
    }
    setPurpose({
      reason: reason.trim(),
      ...(report.trim() ? { relatedReportPublicId: report.trim() } : {}),
    });
  }
  return (
    <section className="admin-page inspection" aria-busy={busy}>
      <header className="inspection__header">
        <a className="inspection__back" href="/admin/tenants">
          ← {labels.back}
        </a>
        <div className="inspection__heading">
          <div>
            <p className="inspection__eyebrow">{labels.readOnly}</p>
            <h1>{labels.title}</h1>
          </div>
          {purpose !== null ? (
            <button
              className="button--secondary"
              type="button"
              onClick={(): void => {
                setPurpose(null);
                setTransferResult(null);
                setOverview(null);
                setReason('');
                setReport('');
              }}
            >
              {labels.end}
            </button>
          ) : null}
        </div>
        <p className="inspection__muted">{labels.explanation}</p>
        {report ? <a href={`/admin/reports/${report}`}>{text.workflow.returnReport}</a> : null}
      </header>
      {purpose === null || error ? (
        <form className="report-form inspection__purpose" noValidate onSubmit={enter}>
          <label>
            {labels.reason}
            <textarea
              aria-required="true"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReason(event.currentTarget.value)
              }
            />
          </label>
          <label>
            {labels.report}
            <input
              value={report}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setReport(event.currentTarget.value)
              }
            />
          </label>
          <button type="submit" disabled={busy}>
            {labels.enter}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="inspection__feedback inspection__feedback--error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="inspection__feedback" role="status">
          {text.loading}
        </p>
      ) : null}
      {transferResult ? (
        <div className="inspection__feedback" role="status">
          <p>{text.ownership.success}</p>
          {transferResult.notifications.map(
            (notification: OwnershipResponse['notifications'][number]): JSX.Element => (
              <p key={notification.recipient}>
                {notification.recipient === 'OLD_OWNER'
                  ? text.ownership.oldOwner
                  : text.ownership.newOwner}
                :{' '}
                {notification.status === 'SENT'
                  ? text.ownership.sentMail
                  : text.ownership.failedMail}
              </p>
            ),
          )}
        </div>
      ) : null}
      {overview ? (
        <>
          <section className="inspection__panel" aria-labelledby="inspection-overview">
            <p className="inspection__eyebrow">{labels.overview}</p>
            <div className="inspection__heading">
              <h2 id="inspection-overview">{overview.cookbook.display_name}</h2>
              <div className="inspection__badges">
                <span
                  className={`inspection__badge${overview.cookbook.disabled_at ? ' inspection__badge--warning' : ''}`}
                >
                  {overview.cookbook.disabled_at ? text.cookbookIdentity.disabled : labels.active}
                </span>
                {overview.cookbook.name_reset_required ? (
                  <span className="inspection__badge inspection__badge--warning">
                    {text.cookbookIdentity.resetPending}
                  </span>
                ) : null}
              </div>
            </div>
            {overview.cookbook.description ? <p>{overview.cookbook.description}</p> : null}
            <dl className="inspection__metadata">
              <div>
                <dt>{labels.owner}</dt>
                <dd>
                  {overview.cookbook.owner_name ?? text.ownership.noOwner}
                  <small>{overview.cookbook.owner_public_id}</small>
                </dd>
              </div>
              <div>
                <dt>{labels.created}</dt>
                <dd>{new Date(overview.cookbook.created_at).toLocaleString(locale)}</dd>
              </div>
              <div>
                <dt>{labels.updated}</dt>
                <dd>{new Date(overview.cookbook.updated_at).toLocaleString(locale)}</dd>
              </div>
            </dl>
          </section>
          {purpose ? (
            <InspectionBrowser
              tenantPath={tenantPath}
              currentPath={currentPath}
              purpose={purpose}
              report={report}
              text={text}
              locale={locale}
              counts={overview.counts}
              actions={
                <InspectionActions
                  cookbook={overview.cookbook}
                  purpose={purpose}
                  report={report}
                  text={text}
                  onSaved={(): void => setPurpose({ ...purpose })}
                  onTransferred={(result: OwnershipResponse): void => {
                    setTransferResult(result);
                    setPurpose({ ...purpose });
                  }}
                />
              }
              navigate={navigate}
              onSaved={(): void => setPurpose({ ...purpose })}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
