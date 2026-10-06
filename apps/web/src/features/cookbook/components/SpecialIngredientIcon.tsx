import type { JSX } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCircleInfo,
  faClock,
  faFireBurner,
  faMinus,
  faPlus,
  faScrewdriverWrench,
  faSnowflake,
  faSpoon,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface SpecialIngredientIconProperties {
  kind: string;
}

const iconByKind: Readonly<Record<string, IconDefinition>> = {
  ADD: faPlus,
  COOL: faSnowflake,
  COOK: faSpoon,
  HEAT: faFireBurner,
  IMPORTANT: faTriangleExclamation,
  INFO: faCircleInfo,
  REMOVE: faMinus,
  WAIT: faClock,
  WORK_STEP: faScrewdriverWrench,
};

export default function SpecialIngredientIcon({
  kind,
}: SpecialIngredientIconProperties): JSX.Element | null {
  const icon: IconDefinition | undefined = iconByKind[kind.toUpperCase()];

  if (icon === undefined) return null;

  return <FontAwesomeIcon aria-hidden="true" className="special-ingredient-icon" icon={icon} />;
}
