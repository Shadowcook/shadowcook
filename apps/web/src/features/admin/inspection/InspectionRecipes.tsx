import type { JSX, MouseEvent } from 'react';
import type { Locale, Translation } from '../../../i18n';
import type { InspectionRecipe, RevisionSummary } from './types';
import { reportLink } from '../reports/links';
import ModerationControl from '../moderation/ModerationControl';
import DeletionControl from '../safety/DeletionControl';
import InspectionCollection from './InspectionCollection';
import InspectionRevisionContent from './InspectionRevisionContent';

export default function InspectionRecipes({
  tenantPath,
  currentPath,
  report,
  purpose,
  text,
  locale,
  navigate,
  onSaved,
}: {
  tenantPath: string;
  currentPath: string;
  report: string;
  purpose: object;
  text: Translation;
  locale: Locale;
  navigate: (event: MouseEvent<HTMLAnchorElement>, target: string) => void;
  onSaved: () => void;
}): JSX.Element {
  const labels: Translation['inspection'] = text.inspection;
  const recipeId: string | undefined =
    currentPath.split('/')[4] === 'recipes' ? currentPath.split('/')[5] : undefined;
  const base: string = `${tenantPath}/inspection#recipes`;
  if (recipeId)
    return (
      <div className="inspection__recipe-detail">
        <a
          href={reportLink(base, report)}
          onClick={(event: MouseEvent<HTMLAnchorElement>): void => navigate(event, base)}
        >
          ← {labels.recipes}
        </a>
        <div className="inspection__workspace">
          <InspectionCollection<RevisionSummary>
            key={recipeId}
            endpoint={`${tenantPath}/recipes/${recipeId}/revisions/inspection`}
            purpose={purpose}
            text={text}
            title={labels.revisions}
            empty={labels.emptyRevisions}
          >
            {(items: RevisionSummary[]): JSX.Element => (
              <ul className="inspection__revisions">
                {items.map((item: RevisionSummary): JSX.Element => {
                  const target: string = `${tenantPath}/recipes/${recipeId}/revisions/${item.public_id}`;
                  return (
                    <li key={item.public_id}>
                      <a
                        href={reportLink(target, report)}
                        aria-current={target === currentPath ? 'page' : undefined}
                        onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                          navigate(event, target)
                        }
                      >
                        <span>{item.title}</span>
                        <small>
                          {labels.revision} {item.revision_no} · {labels.statuses[item.status]}
                        </small>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </InspectionCollection>
          {currentPath.includes('/revisions/') ? (
            <InspectionRevisionContent
              key={currentPath}
              path={currentPath}
              purpose={purpose}
              text={text}
              locale={locale}
            />
          ) : (
            <div className="inspection__panel inspection__placeholder">
              <p>{labels.selectRevision}</p>
            </div>
          )}
        </div>
      </div>
    );
  return (
    <InspectionCollection<InspectionRecipe>
      endpoint={`${tenantPath}/inspection/recipes`}
      purpose={purpose}
      text={text}
      title={labels.recipeList}
      empty={labels.emptyRecipes}
    >
      {(items: InspectionRecipe[]): JSX.Element => (
        <ul className="inspection__record-list inspection__recipe-results">
          {items.map((recipe: InspectionRecipe): JSX.Element => {
            const target: string = `${tenantPath}/recipes/${recipe.public_id}/inspection`;
            return (
              <li key={recipe.public_id}>
                <div className="inspection__heading">
                  <a
                    href={reportLink(target, report)}
                    onClick={(event: MouseEvent<HTMLAnchorElement>): void =>
                      navigate(event, target)
                    }
                  >
                    <strong>{recipe.title ?? recipe.slug}</strong>
                  </a>
                  <div className="inspection__badges">
                    {recipe.deleted_at ? (
                      <span className="inspection__badge inspection__badge--warning">
                        {labels.statuses.deleted}
                      </span>
                    ) : null}
                    {recipe.moderation_blocked_at ? (
                      <span className="inspection__badge inspection__badge--warning">
                        {text.moderation.blocked}
                      </span>
                    ) : null}
                  </div>
                </div>
                <small className="inspection__muted">{recipe.slug}</small>
                <div className="inspection__buttons">
                  <ModerationControl
                    tenantId={tenantPath.split('/')[3]!}
                    recipeId={recipe.public_id}
                    blocked={recipe.moderation_blocked_at !== null}
                    name={recipe.title ?? recipe.slug}
                    text={text}
                    initialReportPublicId={report}
                    onSaved={onSaved}
                  />
                  <span className="inspection__destructive">
                    <DeletionControl
                      tenantId={tenantPath.split('/')[3]!}
                      recipeId={recipe.public_id}
                      name={recipe.title ?? recipe.slug}
                      text={text}
                      relatedReportPublicId={report || undefined}
                      onDeleted={onSaved}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </InspectionCollection>
  );
}
