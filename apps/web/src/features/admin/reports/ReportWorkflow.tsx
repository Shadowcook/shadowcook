import type { JSX } from 'react';
import type { Locale, Translation } from '../../../i18n';
import type { ReportContext } from './types';
import { reportLink } from './links';
import ReportHistory from './ReportHistory';
import ReportNotice from './ReportNotice';
export default function ReportWorkflow({
  reportId,
  context,
  text,
  locale,
  onReload,
}: {
  reportId: string;
  context: ReportContext;
  text: Translation;
  locale: Locale;
  onReload: () => void;
}): JSX.Element {
  return (
    <section>
      <h3>{text.workflow.title}</h3>
      <p>{text.workflow.separation}</p>
      <button type="button" onClick={onReload}>
        {text.workflow.refresh}
      </button>
      {!context.available ? <p role="status">{text.workflow.unavailable}</p> : null}
      {context.inspectionPath ? (
        <p>
          <a href={reportLink(context.inspectionPath, reportId)}>{text.workflow.inspect}</a>
        </p>
      ) : null}
      {context.accountPath ? (
        <p>
          <a href={reportLink(context.accountPath, reportId)}>{text.workflow.account}</a>
        </p>
      ) : null}
      <h4>{text.workflow.current}</h4>
      <dl>
        {Object.entries(text.workflow.states).map(
          ([key, label]: [string, string]): JSX.Element | null => {
            const value: unknown = context[key as keyof ReportContext];
            return typeof value === 'boolean' ? (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{value ? text.workflow.restricted : text.workflow.active}</dd>
              </div>
            ) : null;
          },
        )}
      </dl>
      <ReportNotice reportId={reportId} context={context} text={text} />
      <ReportHistory key={reportId} reportId={reportId} text={text} locale={locale} />
    </section>
  );
}
