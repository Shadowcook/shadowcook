import type { JSX } from 'react';
import { specialIngredientIconPath } from '../model/special-entries';

interface SpecialIngredientIconProperties {
  kind: string;
}

export default function SpecialIngredientIcon({
  kind,
}: SpecialIngredientIconProperties): JSX.Element | null {
  const iconPath: string | null = specialIngredientIconPath(kind);

  if (iconPath === null) return null;

  return <img alt="" aria-hidden="true" className="special-ingredient-icon" src={iconPath} />;
}
