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

export function specialIngredientIconDefinition(kind: string): IconDefinition | undefined {
  return iconByKind[kind.toUpperCase()];
}
