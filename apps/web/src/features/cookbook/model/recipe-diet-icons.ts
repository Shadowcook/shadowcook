import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faEgg, faLeaf } from '@fortawesome/free-solid-svg-icons';
import type { RecipeDiet } from './recipe-metadata.ts';

export function recipeDietIconDefinition(diet: RecipeDiet | null): IconDefinition | null {
  if (diet === 'VEGAN') return faLeaf;
  if (diet === 'VEGETARIAN') return faEgg;
  return null;
}
