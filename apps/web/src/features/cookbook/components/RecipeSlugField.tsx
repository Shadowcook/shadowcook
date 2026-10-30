import { useId } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { RecipeSlugStatus } from '../model/use-recipe-slug-availability';

interface RecipeSlugFieldProperties {
  value: string;
  status: RecipeSlugStatus;
  text: Translation;
  onChange: (value: string) => void;
}

export default function RecipeSlugField(properties: RecipeSlugFieldProperties): JSX.Element {
  const feedbackId: string = useId();
  const feedback: string | null =
    properties.status === 'conflict'
      ? properties.text.recipeEditor.slugConflict
      : properties.status === 'invalid'
        ? properties.text.recipeEditor.invalidSlug
        : properties.status === 'checking'
          ? properties.text.recipeEditor.slugChecking
          : properties.status === 'failed'
            ? properties.text.recipeEditor.slugCheckFailed
            : null;
  const isInvalid: boolean = properties.status === 'conflict' || properties.status === 'invalid';

  return (
    <div>
      <label>
        {properties.text.recipeEditor.slug}
        <input
          value={properties.value}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            properties.onChange(event.currentTarget.value.toLowerCase())
          }
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
          aria-invalid={isInvalid}
          aria-describedby={feedback === null ? undefined : feedbackId}
        />
      </label>
      {feedback === null ? null : (
        <p id={feedbackId} className={isInvalid ? 'message' : 'hint'} aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  );
}
