import type { JSX } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Translation } from '../../../i18n';
import type { RecipeDiet } from '../model/recipe-metadata';
import { recipeDietIconDefinition } from '../model/recipe-diet-icons';

interface RecipeDietIconProperties {
  diet: RecipeDiet | null;
  text: Translation;
  showLabel?: boolean;
}

export default function RecipeDietIcon({
  diet,
  text,
  showLabel = false,
}: RecipeDietIconProperties): JSX.Element | null {
  const icon: IconDefinition | null = recipeDietIconDefinition(diet);
  if (icon === null || diet === null) return null;

  const label: string = text.recipeMetadata.diets[diet];
  const symbol: JSX.Element = <FontAwesomeIcon icon={icon} aria-hidden="true" />;

  if (showLabel) {
    return (
      <span className="recipe-diet-label">
        <span className="recipe-diet-icon" aria-hidden="true">
          {symbol}
        </span>
        {label}
      </span>
    );
  }

  return (
    <span className="recipe-diet-icon" role="img" aria-label={label} title={label}>
      {symbol}
    </span>
  );
}
