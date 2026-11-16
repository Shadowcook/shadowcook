import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { InspectionOverview } from './types';
import ModerationControl from '../moderation/ModerationControl';
import DeletionControl from '../safety/DeletionControl';
import OwnershipTransfer, { type OwnershipResponse } from '../ownership/OwnershipTransfer';

export default function InspectionActions({
  cookbook,
  purpose,
  report,
  text,
  onSaved,
  onTransferred,
}: {
  cookbook: InspectionOverview['cookbook'];
  purpose: object;
  report: string;
  text: Translation;
  onSaved: () => void;
  onTransferred: (result: OwnershipResponse) => void;
}): JSX.Element {
  return (
    <div className="inspection__action-panels">
      <section
        className="inspection__panel inspection__action-panel"
        aria-labelledby="inspection-actions"
      >
        <h2 id="inspection-actions">{text.inspection.actions}</h2>
        <p className="inspection__muted">{text.inspection.actionsHelp}</p>
        <div className="inspection__buttons">
          <ModerationControl
            tenantId={cookbook.public_id}
            blocked={cookbook.disabled_at !== null}
            name={cookbook.display_name}
            text={text}
            initialReportPublicId={report}
            onSaved={onSaved}
          />
          <span className="inspection__destructive">
            <DeletionControl
              tenantId={cookbook.public_id}
              name={cookbook.display_name}
              text={text}
              relatedReportPublicId={report || undefined}
              onDeleted={(): void => window.location.assign('/admin/tenants')}
            />
          </span>
        </div>
      </section>
      <div className="inspection__panel">
        <OwnershipTransfer
          cookbook={cookbook}
          purpose={purpose}
          text={text}
          onTransferred={onTransferred}
        />
      </div>
    </div>
  );
}
