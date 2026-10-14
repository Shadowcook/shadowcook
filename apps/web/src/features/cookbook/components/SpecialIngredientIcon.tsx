import type { JSX } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { specialIngredientIconDefinition } from '../model/special-ingredient-icons';

interface SpecialIngredientIconProperties {
  kind: string;
}

export default function SpecialIngredientIcon({
  kind,
}: SpecialIngredientIconProperties): JSX.Element | null {
  const icon: IconDefinition | undefined = specialIngredientIconDefinition(kind);

  if (icon === undefined) return null;

  return <FontAwesomeIcon aria-hidden="true" className="special-ingredient-icon" icon={icon} />;
}
