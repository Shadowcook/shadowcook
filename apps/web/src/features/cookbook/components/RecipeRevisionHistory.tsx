import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';

interface Revision {
  publicId: string;
  version: number;
  status: 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string;
  title: string;
}
interface RevisionCategory {
  publicId: string;
  name: string;
}
interface RevisionUsage {
  usageKey: string;
  ingredientName: string | null;
  textOverride: string | null;
  specialKind: string | null;
  amount: string | null;
  unitSymbol: string | null;
  note: string | null;
  isOptional: boolean;
  sortOrder: number;
}
interface RevisionStep {
  stepKey: string;
  sortOrder: number;
  instruction: string;
  ingredients: RevisionUsage[];
}
interface RevisionVariant {
  variantKey: string;
  name: string;
  slug: string;
  isDefault: boolean;
  isVisible: boolean;
  includedStepKeys: string[];
}
interface RevisionSnapshot extends Revision {
  summary: string | null;
  categories: RevisionCategory[];
  steps: RevisionStep[];
  variants: RevisionVariant[];
}
interface Properties {
  tenantSlug: string;
  recipePublicId: string;
  text: Translation;
}

export default function RecipeRevisionHistory(properties: Properties): JSX.Element {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<RevisionSnapshot | null>(null);
  const [previous, setPrevious] = useState<RevisionSnapshot | null>(null);
  const [message, setMessage] = useState<string>('');
  const base: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/revisions`;

  useEffect((): void => {
    void loadRevisions();
  }, [base]);

  async function loadRevisions(): Promise<void> {
    setMessage('');
    try {
      const response: { revisions: Revision[] } = await request<{ revisions: Revision[] }>(base);
      const loaded: Revision[] = Array.isArray(response.revisions) ? response.revisions : [];
      setRevisions(loaded);
      if (loaded[0] !== undefined) await selectRevision(loaded[0], loaded);
    } catch (_error: unknown) {
      setMessage(properties.text.errors.requestFailed);
    }
  }
  async function selectRevision(
    revision: Revision,
    allRevisions: Revision[] = revisions,
  ): Promise<void> {
    setMessage('');
    try {
      const selectedSnapshot: RevisionSnapshot = await request<RevisionSnapshot>(
        `${base}/${revision.publicId}`,
      );
      setSelected(selectedSnapshot);
      const index: number = allRevisions.findIndex(
        (candidate: Revision): boolean => candidate.publicId === revision.publicId,
      );
      const predecessor: Revision | undefined = index === -1 ? undefined : allRevisions[index + 1];
      setPrevious(
        predecessor === undefined
          ? null
          : await request<RevisionSnapshot>(`${base}/${predecessor.publicId}`),
      );
    } catch (_error: unknown) {
      setMessage(properties.text.errors.requestFailed);
    }
  }

  if (message.length > 0) return <p className="message">{message}</p>;
  if (revisions.length === 0)
    return <p className="empty-state">{properties.text.recipeEditor.noRevisions}</p>;
  return (
    <section className="recipe-revision-history">
      <div
        className="recipe-revision-history__list"
        aria-label={properties.text.recipeEditor.revisionHistory}
      >
        {revisions.map((revision: Revision): JSX.Element => (
          <button
            type="button"
            key={revision.publicId}
            className={selected?.publicId === revision.publicId ? '' : 'button--secondary'}
            onClick={(): void => void selectRevision(revision)}
          >
            {properties.text.recipeEditor.version} {revision.version}: {revision.title}
          </button>
        ))}
      </div>
      {selected === null ? (
        <p className="empty-state">{properties.text.loading}</p>
      ) : (
        <Snapshot snapshot={selected} text={properties.text} />
      )}
      {selected === null ? null : (
        <ChangeSummary current={selected} previous={previous} text={properties.text} />
      )}
      <p className="hint">{properties.text.recipeEditor.revisionReadOnly}</p>
    </section>
  );
}

function Snapshot(properties: { snapshot: RevisionSnapshot; text: Translation }): JSX.Element {
  const snapshot: RevisionSnapshot = properties.snapshot;
  return (
    <section className="recipe-revision-history__snapshot">
      <h2>{properties.text.recipeEditor.revisionSnapshot}</h2>
      <p>
        {properties.text.recipeEditor.version} {snapshot.version} ·{' '}
        {properties.text.recipeEditor.publishedAt}:{' '}
        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(snapshot.publishedAt),
        )}
      </p>
      <h3>{snapshot.title}</h3>
      {snapshot.summary === null || snapshot.summary.length === 0 ? null : (
        <p>{snapshot.summary}</p>
      )}
      <p>
        {snapshot.categories.map((category: RevisionCategory): string => category.name).join(', ')}
      </p>
      {snapshot.steps.map((step: RevisionStep): JSX.Element => (
        <article key={step.stepKey} className="recipe-revision-history__step">
          <h4>
            {step.sortOrder + 1}.{' '}
            <span className="recipe-revision-history__instruction">{step.instruction}</span>
          </h4>
          {step.ingredients.length === 0 ? null : (
            <ul>
              {step.ingredients.map((usage: RevisionUsage): JSX.Element => (
                <li key={usage.usageKey}>{formatUsage(usage)}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
      <h3>{properties.text.recipeEditor.variants}</h3>
      <ul>
        {snapshot.variants.map((variant: RevisionVariant): JSX.Element => (
          <li key={variant.variantKey}>
            {variant.name} ({variant.slug})
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeSummary(properties: {
  current: RevisionSnapshot;
  previous: RevisionSnapshot | null;
  text: Translation;
}): JSX.Element {
  if (properties.previous === null)
    return <p className="hint">{properties.text.recipeEditor.noPreviousRevision}</p>;
  const changes: string[] = changesFor(properties.current, properties.previous, properties.text);
  return (
    <section className="recipe-revision-history__changes">
      <h2>{properties.text.recipeEditor.changes}</h2>
      <p className="hint">{properties.text.recipeEditor.compareWithPrevious}</p>
      {changes.length === 0 ? (
        <p>{properties.text.recipeEditor.noChanges}</p>
      ) : (
        <ul>
          {changes.map((change: string): JSX.Element => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function changesFor(
  current: RevisionSnapshot,
  previous: RevisionSnapshot,
  text: Translation,
): string[] {
  const changes: string[] = [];
  if (current.title !== previous.title) changes.push(text.recipeEditor.titleChanged);
  if (current.summary !== previous.summary) changes.push(text.recipeEditor.summaryChanged);
  if (!sameValues(current.categories.map(categoryKey), previous.categories.map(categoryKey)))
    changes.push(text.recipeEditor.categoriesChanged);
  if (!sameMappedValues(current.steps, previous.steps, stepKey, stepValue))
    changes.push(text.recipeEditor.stepsChanged);
  if (
    !sameMappedValues(flatUsages(current.steps), flatUsages(previous.steps), usageKey, usageValue)
  )
    changes.push(text.recipeEditor.ingredientsChanged);
  if (!sameMappedValues(current.variants, previous.variants, variantKey, variantValue))
    changes.push(text.recipeEditor.variantsChanged);
  return changes;
}
function categoryKey(category: RevisionCategory): string {
  return category.publicId;
}
function stepKey(step: RevisionStep): string {
  return step.stepKey;
}
function stepValue(step: RevisionStep): string {
  return `${step.sortOrder}|${step.instruction}`;
}
function usageKey(usage: RevisionUsage): string {
  return usage.usageKey;
}
function usageValue(usage: RevisionUsage): string {
  return [
    usage.ingredientName,
    usage.textOverride,
    usage.specialKind,
    displayAmount(usage.amount),
    usage.unitSymbol,
    usage.note,
    usage.isOptional,
    usage.sortOrder,
  ].join('|');
}
function variantKey(variant: RevisionVariant): string {
  return variant.variantKey;
}
function variantValue(variant: RevisionVariant): string {
  return [
    variant.name,
    variant.slug,
    variant.isDefault,
    variant.isVisible,
    ...variant.includedStepKeys,
  ].join('|');
}
function flatUsages(steps: RevisionStep[]): RevisionUsage[] {
  return steps.flatMap((step: RevisionStep): RevisionUsage[] => step.ingredients);
}
function sameValues(current: string[], previous: string[]): boolean {
  return current.sort().join('|') === previous.sort().join('|');
}
function sameMappedValues<T>(
  current: T[],
  previous: T[],
  key: (value: T) => string,
  value: (item: T) => string,
): boolean {
  const currentValues: string[] = current
    .map((item: T): string => `${key(item)}=${value(item)}`)
    .sort();
  const previousValues: string[] = previous
    .map((item: T): string => `${key(item)}=${value(item)}`)
    .sort();
  return currentValues.join('\n') === previousValues.join('\n');
}
function formatUsage(usage: RevisionUsage): string {
  if (usage.specialKind !== null) return usage.textOverride ?? '';
  return [
    displayAmount(usage.amount),
    usage.unitSymbol,
    usage.ingredientName ?? usage.textOverride,
    usage.note,
  ]
    .filter((value: string | null): value is string => value !== null && value.length > 0)
    .join(' ');
}
function displayAmount(amount: string | null): string | null {
  if (amount === null || !amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
