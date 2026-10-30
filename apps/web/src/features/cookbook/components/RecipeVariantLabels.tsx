import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { RecipeVariant } from '../model/types';
import RecipeDietIcon from './RecipeDietIcon';

interface RecipeVariantLabelsProperties {
  variants: RecipeVariant[];
  text: Translation;
}

const maximumVariantLabels: number = 10;

export default function RecipeVariantLabels(
  properties: RecipeVariantLabelsProperties,
): JSX.Element | null {
  const variants: RecipeVariant[] = properties.variants.filter(
    (variant: RecipeVariant): boolean => !variant.is_default,
  );
  if (variants.length === 0) return null;

  const remainingCount: number = variants.length - maximumVariantLabels;
  return (
    <div className="recipe-card__variants">
      <strong className="recipe-card__variants-label">
        {properties.text.dashboard.variantsLabel}
      </strong>
      {variants.slice(0, maximumVariantLabels).map((variant: RecipeVariant): JSX.Element => (
        <span key={variant.variant_key}>
          <RecipeDietIcon diet={variant.diet} text={properties.text} />
          {variant.name}
        </span>
      ))}
      {remainingCount > 0 ? (
        <span>
          {properties.text.dashboard.moreVariants.replace('{count}', String(remainingCount))}
        </span>
      ) : null}
    </div>
  );
}
