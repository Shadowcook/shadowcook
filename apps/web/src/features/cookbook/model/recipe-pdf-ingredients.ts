import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { Content, ContentText } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import { ingredientAmountText } from './recipe-presentation.ts';
import { specialIngredientIconDefinition } from './special-ingredient-icons.ts';
import type { IngredientUsage } from './types.ts';

export function recipePdfIngredientContent(
  ingredient: IngredientUsage,
  text: Translation,
): Content {
  if (ingredient.special_kind !== null) {
    const note: ContentText = { text: ingredient.note ?? '', italics: true };
    const icon: IconDefinition | undefined = specialIngredientIconDefinition(
      ingredient.special_kind,
    );
    if (icon === undefined) return { ...note, margin: [0, 0, 0, 6] };

    return {
      columns: [
        { svg: iconSvg(icon), fit: [12, 12], width: 12 },
        { ...note, width: '*' },
      ],
      columnGap: 6,
      margin: [0, 0, 0, 6],
    };
  }

  const amount: string = ingredientAmountText(ingredient, text);
  return {
    text: [
      { text: amount.length > 0 ? `${amount} ` : '' },
      { text: ingredient.ingredient_name, bold: true },
      ...(ingredient.note === null || ingredient.note.length === 0
        ? []
        : [{ text: ` ${ingredient.note}`, italics: true }]),
      ...(ingredient.is_optional ? [{ text: ` (${text.dashboard.optional})`, italics: true }] : []),
    ],
    margin: [0, 0, 0, 6],
  };
}

function iconSvg(icon: IconDefinition): string {
  const width: number = icon.icon[0];
  const height: number = icon.icon[1];
  const pathData: string | string[] = icon.icon[4];
  const paths: string[] = typeof pathData === 'string' ? [pathData] : pathData;
  const svgPaths: string = paths
    .map((path: string): string => `<path fill="#302820" d="${path}" />`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgPaths}</svg>`;
}
