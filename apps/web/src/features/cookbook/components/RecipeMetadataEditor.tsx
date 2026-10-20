import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import {
  recipeKcalPerServing,
  type RecipeContentMetadata,
  type RecipeDiet,
  type RecipeDifficulty,
} from '../model/recipe-metadata';
import RecipeDurationInput from './RecipeDurationInput';

interface Properties {
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  text: Translation;
  onChange: (metadata: RecipeContentMetadata, diet: RecipeDiet | null) => void;
}

export default function RecipeMetadataEditor({
  metadata,
  diet,
  text,
  onChange,
}: Properties): JSX.Element {
  const labels: Translation['recipeMetadata'] = text.recipeMetadata;
  const perServing: number | null = recipeKcalPerServing(metadata);
  function update(changes: Partial<RecipeContentMetadata>): void {
    onChange({ ...metadata, ...changes }, diet);
  }
  return (
    <fieldset>
      <legend>{labels.title}</legend>
      <label>
        {labels.difficulty}
        <select
          value={metadata.difficulty ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            update({
              difficulty:
                event.currentTarget.value === ''
                  ? null
                  : (event.currentTarget.value as RecipeDifficulty),
            })
          }
        >
          <option value="">{labels.unspecified}</option>
          {(['EASY', 'MEDIUM', 'DEMANDING'] as RecipeDifficulty[]).map(
            (value: RecipeDifficulty): JSX.Element => (
              <option key={value} value={value}>
                {labels.difficulties[value]}
              </option>
            ),
          )}
        </select>
      </label>
      <RecipeDurationInput
        label={labels.totalDuration}
        value={metadata.totalMinutes}
        text={text}
        onChange={(totalMinutes: number | null): void => update({ totalMinutes })}
      />
      <RecipeDurationInput
        label={labels.activeDuration}
        value={metadata.activeMinutes}
        text={text}
        onChange={(activeMinutes: number | null): void => update({ activeMinutes })}
      />
      <label>
        {labels.kcal}
        <input
          type="number"
          min={0}
          max={1000000000}
          step="any"
          value={metadata.kcal ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            update({
              kcal: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
            })
          }
        />
      </label>
      <label>
        {labels.servings}
        <input
          type="number"
          min={0.000001}
          max={1000000}
          step="any"
          value={metadata.servings ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            update({
              servings: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
            })
          }
        />
      </label>
      {perServing === null ? null : (
        <p className="hint">
          {labels.kcalPerServing}:{' '}
          <output>
            {new Intl.NumberFormat(text.locale, { maximumFractionDigits: 2 }).format(perServing)}
          </output>
        </p>
      )}
      <label>
        {labels.utensils}
        <textarea
          value={metadata.utensils ?? ''}
          maxLength={4000}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
            update({
              utensils: event.currentTarget.value === '' ? null : event.currentTarget.value,
            })
          }
        />
      </label>
      <label>
        {labels.diet}
        <select
          value={diet ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            onChange(
              metadata,
              event.currentTarget.value === '' ? null : (event.currentTarget.value as RecipeDiet),
            )
          }
        >
          <option value="">{labels.unspecified}</option>
          {(['VEGAN', 'VEGETARIAN', 'OMNI'] as RecipeDiet[]).map(
            (value: RecipeDiet): JSX.Element => (
              <option key={value} value={value}>
                {labels.diets[value]}
              </option>
            ),
          )}
        </select>
      </label>
    </fieldset>
  );
}
