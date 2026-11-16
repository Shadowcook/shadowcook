import { useEffect, useState } from 'react';
import type { JSX, MouseEvent, ReactNode } from 'react';
import type { Locale, Translation } from '../../../i18n';
import type { InspectionOverview } from './types';
import { reportLink } from '../reports/links';
import InspectionRecipes from './InspectionRecipes';
import InspectionRecords from './InspectionRecords';

type InspectionTab = 'recipes' | 'members' | 'reports' | 'actions';
function currentTab(): InspectionTab {
  const hash: string = typeof window === 'undefined' ? '' : window.location.hash;
  if (hash === '#actions') return 'actions';
  return hash === '#members' ? 'members' : hash === '#reports' ? 'reports' : 'recipes';
}
export default function InspectionBrowser({
  tenantPath,
  currentPath,
  purpose,
  report,
  text,
  locale,
  counts,
  actions,
  navigate,
  onSaved,
}: {
  tenantPath: string;
  currentPath: string;
  purpose: object;
  report: string;
  text: Translation;
  locale: Locale;
  counts: InspectionOverview['counts'];
  actions: ReactNode;
  navigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
  onSaved: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<InspectionTab>(currentTab);
  useEffect((): (() => void) => {
    const update: () => void = (): void => setTab(currentTab());
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return (): void => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return (
    <div className="inspection__browser">
      <nav className="inspection__tabs" aria-label={text.inspection.sections}>
        {(['recipes', 'members', 'reports', 'actions'] as InspectionTab[]).map(
          (item: InspectionTab): JSX.Element => {
            const target: string = `${tenantPath}/inspection#${item}`;
            return (
              <a
                key={item}
                href={reportLink(target, report)}
                aria-current={tab === item ? 'page' : undefined}
                onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  )
                    setTab(item);
                  navigate(event, target);
                }}
              >
                {text.inspection[item]}
                {item !== 'actions' ? (
                  <span className="inspection__count">{counts[item]}</span>
                ) : null}
              </a>
            );
          },
        )}
      </nav>
      {tab === 'actions' ? (
        actions
      ) : tab === 'recipes' ? (
        <InspectionRecipes
          tenantPath={tenantPath}
          currentPath={currentPath}
          report={report}
          purpose={purpose}
          text={text}
          locale={locale}
          navigate={navigate}
          onSaved={onSaved}
        />
      ) : (
        <InspectionRecords
          key={tab}
          kind={tab}
          tenantPath={tenantPath}
          purpose={purpose}
          text={text}
          locale={locale}
        />
      )}
    </div>
  );
}
