import type { JSX } from 'react';
import type { Locale, Translation } from '../../../i18n';
import type { InspectionMember, InspectionReport } from './types';
import InspectionCollection from './InspectionCollection';

export default function InspectionRecords({
  kind,
  tenantPath,
  purpose,
  text,
  locale,
}: {
  kind: 'members' | 'reports';
  tenantPath: string;
  purpose: object;
  text: Translation;
  locale: Locale;
}): JSX.Element {
  const labels: Translation['inspection'] = text.inspection;
  if (kind === 'members')
    return (
      <InspectionCollection<InspectionMember>
        endpoint={`${tenantPath}/inspection/members`}
        purpose={purpose}
        text={text}
        title={labels.members}
        empty={labels.emptyMembers}
      >
        {(items: InspectionMember[]): JSX.Element => (
          <ul className="inspection__record-list">
            {items.map((member: InspectionMember): JSX.Element => (
              <li key={member.public_id}>
                <div className="inspection__heading">
                  <strong>{member.display_name}</strong>
                  <span className="inspection__badges">
                    {member.roles.map((role: string): JSX.Element => (
                      <span key={role} className="inspection__badge">
                        {labels.statuses[role] ?? role}
                      </span>
                    ))}
                  </span>
                </div>
                <small className="inspection__identifier">{member.public_id}</small>
                <small className="inspection__muted">
                  {labels.joined}: {new Date(member.joined_at).toLocaleString(locale)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </InspectionCollection>
    );
  return (
    <InspectionCollection<InspectionReport>
      endpoint={`${tenantPath}/inspection/reports`}
      purpose={purpose}
      text={text}
      title={labels.reports}
      empty={labels.emptyReports}
    >
      {(items: InspectionReport[]): JSX.Element => (
        <ul className="inspection__record-list">
          {items.map((item: InspectionReport): JSX.Element => (
            <li key={item.public_id}>
              <a className="inspection__identifier" href={`/admin/reports/${item.public_id}`}>
                {item.public_id}
              </a>
              <div className="inspection__heading">
                <span className="inspection__badge">{labels.statuses[item.status]}</span>
                <small className="inspection__muted">
                  {new Date(item.created_at).toLocaleString(locale)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </InspectionCollection>
  );
}
