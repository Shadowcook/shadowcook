import type { Content, TableCell } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import { recipeMetadataRows, type RecipeFacts, type RecipeMetadataRow } from './recipe-metadata.ts';

export function createRecipePdfMetadata(
  recipe: Partial<RecipeFacts>,
  text: Translation,
): Content[] {
  const rows: RecipeMetadataRow[] = recipeMetadataRows(recipe, text);
  if (rows.length === 0) return [];
  const body: TableCell[][] = [
    [{ text: text.recipeMetadata.title, style: 'heading', colSpan: 2 }, {}],
    ...rows.map((row: RecipeMetadataRow): TableCell[] => [
      { text: row.label, bold: true, margin: [0, 3, 12, 3] },
      { text: row.value, margin: [0, 3, 0, 3], preserveLeadingSpaces: true },
    ]),
  ];
  return [
    {
      margin: [0, 20, 0, 0],
      table: { headerRows: 1, widths: ['auto', '*'], body, dontBreakRows: false },
      layout: 'noBorders',
    },
  ];
}
