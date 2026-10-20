import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { Content } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import type { RecipeDiet } from './recipe-metadata.ts';
import { recipeDietIconDefinition } from './recipe-diet-icons.ts';
import { recipePdfIconSvg } from './recipe-pdf-icons.ts';

export function createRecipePdfDiet(diet: RecipeDiet | null, text: Translation): Content[] {
  const icon: IconDefinition | null = recipeDietIconDefinition(diet);
  if (icon === null || diet === null) return [];

  return [
    {
      columns: [
        { svg: recipePdfIconSvg(icon, '#28723b'), fit: [12, 12], width: 12 },
        { text: text.recipeMetadata.diets[diet], fontSize: 10, color: '#28723b' },
      ],
      columnGap: 6,
      margin: [0, 0, 0, 12],
      unbreakable: true,
    },
  ];
}
