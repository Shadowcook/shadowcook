import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import SpecialIngredientIcon from '../components/SpecialIngredientIcon';
import {
  emptyRecipeMetadata,
  recipeMetadataRows,
  type RecipeMetadataRow,
} from '../model/recipe-metadata';
import type { ImportDocument, ImportEntity, ImportEntry, ImportStep, ImportVariant } from './types';

export default function ImportRecipePreview({
  document,
  text,
}: {
  document: ImportDocument;
  text: Translation;
}): JSX.Element {
  const ingredients: Map<string, ImportEntity> = new Map(
    document.ingredients.map((entity: ImportEntity): [string, ImportEntity] => [
      entity.key,
      entity,
    ]),
  );
  const units: Map<string, ImportEntity> = new Map(
    document.units.map((entity: ImportEntity): [string, ImportEntity] => [entity.key, entity]),
  );
  function entryName(entry: ImportEntry): string {
    const amount: string =
      entry.amount === undefined
        ? ''
        : entry.amount.replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '');
    return [
      amount,
      entry.unitKey === undefined ? '' : units.get(entry.unitKey)!.symbol,
      entry.alias ??
        entry.text ??
        (entry.ingredientKey === undefined ? '' : ingredients.get(entry.ingredientKey)!.name),
    ]
      .filter(Boolean)
      .join(' ');
  }
  return (
    <article className="recipe-import__preview">
      <h3>{document.recipe.title}</h3>
      {document.recipe.summary ? <p>{document.recipe.summary}</p> : null}
      <p>
        {text.recipeImport.wizard.overviewSummary
          .replace('{steps}', String(document.recipe.steps.length))
          .replace('{ingredients}', String(document.ingredients.length))
          .replace('{variants}', String(document.recipe.variants.length))}
      </p>
      <p>
        <strong>{text.recipeImport.variant}: </strong>
        {document.recipe.variants.map((variant: ImportVariant): string => variant.name).join(', ')}
      </p>
      <ol className="recipe-import__steps">
        {document.recipe.steps.map((step: ImportStep): JSX.Element => (
          <li key={step.key}>
            {document.recipe.variants.length > 1 ? (
              <p className="hint">
                {text.recipeImport.variant}:{' '}
                {document.recipe.variants
                  .filter((variant: ImportVariant): boolean =>
                    variant.includedStepKeys.includes(step.key),
                  )
                  .map((variant: ImportVariant): string => variant.name)
                  .join(', ')}
              </p>
            ) : null}
            <p className="recipe-import__instruction">{step.instruction}</p>
            {step.entries.length === 0 ? null : (
              <ul>
                {step.entries.map((entry: ImportEntry): JSX.Element => (
                  <li key={entry.key}>
                    {entry.kind === 'special' ? (
                      <SpecialIngredientIcon kind={entry.specialKind!} />
                    ) : (
                      <strong>{entryName(entry)}</strong>
                    )}
                    {entry.isOptional ? <span> ({text.dashboard.optional})</span> : null}
                    {entry.note ? <span> {entry.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {document.recipe.variants.map((variant: ImportVariant): JSX.Element => (
        <section key={variant.key}>
          <h4>
            {variant.name}: {text.recipeMetadata.title}
          </h4>
          <dl className="recipe-import__facts">
            {recipeMetadataRows(
              {
                metadata: {
                  ...emptyRecipeMetadata(),
                  ...(variant.metadata ?? document.recipe.metadata),
                },
                diet: variant.diet === undefined ? (document.recipe.diet ?? null) : variant.diet,
              },
              text,
            ).map((row: RecipeMetadataRow): JSX.Element => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {document.recipe.provenance === undefined ? null : (
        <p className="hint">
          {text.recipeImport.sourceLabel}: {document.recipe.provenance.source.instanceUrl}.{' '}
          {text.recipeImport.unverified}
        </p>
      )}
    </article>
  );
}
