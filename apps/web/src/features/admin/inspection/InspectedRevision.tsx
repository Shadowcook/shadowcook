import { formatInspectionAmount } from './format';
import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Locale, Translation } from '../../../i18n';
import type { InspectionRevision } from './types';

export default function InspectedRevision({
  data,
  images,
  text,
  locale,
}: {
  data: InspectionRevision;
  images: string[];
  text: Translation;
  locale: Locale;
}): JSX.Element {
  const [variantKey, setVariantKey] = useState<string>(data.variants[0]?.variant_key ?? '');
  useEffect((): void => setVariantKey(data.variants[0]?.variant_key ?? ''), [data]);
  const variant: InspectionRevision['variants'][number] | undefined = data.variants.find(
    (item: InspectionRevision['variants'][number]): boolean => item.variant_key === variantKey,
  );
  const labels: Translation['inspection'] = text.inspection;
  return (
    <article
      id="inspection-revision-content"
      className="inspection__panel inspection__revision"
      aria-labelledby="inspection-revision"
      tabIndex={-1}
    >
      <p className="inspection__eyebrow">
        {labels.revision} {data.revision.revision_no}
      </p>
      <h2 id="inspection-revision">{data.revision.title}</h2>
      <p>{data.revision.summary}</p>
      <p className="inspection__muted">
        {labels.statuses[data.revision.status]} ·{' '}
        {new Date(data.revision.created_at).toLocaleString(locale)}
      </p>
      <p>{data.categories.map((category: { name: string }): string => category.name).join(', ')}</p>
      <div className="inspection__images">
        {images.map((src: string): JSX.Element => (
          <img key={src} src={src} alt={labels.image} />
        ))}
      </div>
      <label className="inspection__variant">
        {labels.variant}
        <select
          value={variantKey}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setVariantKey(event.currentTarget.value)
          }
        >
          {data.variants.map((item: InspectionRevision['variants'][number]): JSX.Element => (
            <option key={item.variant_key} value={item.variant_key}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {variant ? (
        <>
          <dl className="inspection__metadata">
            {Object.entries({ ...variant.metadata, diet: variant.diet })
              .filter((entry: [string, string | number | null]): boolean => entry[1] !== null)
              .map(([key, value]: [string, string | number | null]): JSX.Element => (
                <div key={key}>
                  <dt>{labels.metadata[key]}</dt>
                  <dd>
                    {typeof value === 'number'
                      ? value.toLocaleString(locale, { maximumFractionDigits: 12 })
                      : key === 'difficulty' || key === 'diet'
                        ? (labels.statuses[String(value)] ?? value)
                        : value}
                  </dd>
                </div>
              ))}
          </dl>
          <h3>{labels.steps}</h3>
          <ol className="inspection__steps">
            {data.steps
              .filter((step: InspectionRevision['steps'][number]): boolean =>
                variant.step_keys.includes(step.step_key),
              )
              .map((step: InspectionRevision['steps'][number]): JSX.Element => (
                <li key={step.step_key}>
                  <p>{step.instruction}</p>
                  <ul>
                    {step.ingredients.map(
                      (
                        ingredient: InspectionRevision['steps'][number]['ingredients'][number],
                        index: number,
                      ): JSX.Element => (
                        <li key={index}>
                          {ingredient.amount === null
                            ? ''
                            : formatInspectionAmount(ingredient.amount, locale)}{' '}
                          {ingredient.unit}{' '}
                          {ingredient.special_kind ? labels.statuses[ingredient.special_kind] : ''}{' '}
                          {ingredient.name} {ingredient.note}{' '}
                          {ingredient.optional ? labels.optional : ''}
                        </li>
                      ),
                    )}
                  </ul>
                </li>
              ))}
          </ol>
        </>
      ) : null}
    </article>
  );
}
