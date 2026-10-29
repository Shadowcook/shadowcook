import { useId } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { changeImportVariantName, importVariantSlugStatus } from './model';
import type { ImportVariant, ImportVariantDetails } from './types';

interface Properties {
  variant: ImportVariant;
  details: ImportVariantDetails;
  variants: ImportVariantDetails[];
  text: Translation;
  onChange: (details: ImportVariantDetails) => void;
}

export default function ImportVariantFields(properties: Properties): JSX.Element {
  const feedbackId: string = useId();
  const status: 'valid' | 'invalid' | 'conflict' = importVariantSlugStatus(
    properties.details,
    properties.variants,
  );
  const text: Translation['recipeEditor'] = properties.text.recipeEditor;
  return (
    <div>
      <label>
        {text.variantName}
        {properties.variants.length === 1 ? '' : `: ${properties.variant.name}`}
        {properties.variant.isDefault ? ` (${text.variantDefault})` : ''}
        <input
          value={properties.details.name}
          placeholder={text.variantDefault}
          maxLength={240}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            properties.onChange(
              changeImportVariantName(
                properties.details,
                event.currentTarget.value,
                text.variantDefault,
              ),
            )
          }
        />
      </label>
      <label>
        {text.variantUrl}
        <input
          value={properties.details.slug}
          maxLength={160}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
          aria-invalid={status !== 'valid'}
          aria-describedby={status === 'valid' ? undefined : feedbackId}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            properties.onChange({
              ...properties.details,
              slug: event.currentTarget.value.toLowerCase(),
            })
          }
        />
      </label>
      {status === 'valid' ? null : (
        <p id={feedbackId} className="message" aria-live="polite">
          {status === 'conflict' ? text.variantSlugConflict : text.invalidSlug}
        </p>
      )}
    </div>
  );
}
