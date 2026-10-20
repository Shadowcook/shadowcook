import type { Column, Content, ContentStack } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import type { RecipeDetail } from './types.ts';

const headerWidth: number = 515.28;

export function createRecipePdfHeader(
  recipe: RecipeDetail,
  text: Translation,
  currentPage: number,
  hasLogo: boolean,
): ContentStack {
  const isCover: boolean = currentPage === 1;
  const logoSize: number = isCover ? 24 : 18;
  const brandWidth: number = 82;
  const titleFontSize: number = isCover ? 16 : 12;
  const versionWidth: number = 56;
  const columnGap: number = 12;
  const metadataWidth: number = headerWidth - brandWidth - versionWidth - columnGap * 2;
  const brandColumns: Column[] = [];
  if (hasLogo) {
    brandColumns.push({
      width: logoSize,
      stack: [{ image: 'shadowcookLogo', fit: [logoSize, logoSize] }],
    });
  }
  brandColumns.push({
    text: text.brandName,
    width: '*',
    fontSize: 8,
    color: '#685b52',
    margin: [0, hasLogo ? (isCover ? 8 : 5) : 0, 0, 0],
  });
  const columns: Column[] = [
    {
      width: metadataWidth,
      stack: [
        {
          text: headerName(recipe.title, metadataWidth, titleFontSize),
          fontSize: titleFontSize,
          bold: true,
          color: '#302820',
        },
        {
          text: headerName(recipe.cookbook_name, metadataWidth, 9),
          fontSize: 9,
          color: '#685b52',
        },
      ],
      noWrap: true,
      lineHeight: 1,
    },
    {
      width: versionWidth,
      stack: [
        { text: text.recipeEditor.version, fontSize: 8, color: '#685b52' },
        { text: String(recipe.version), fontSize: 9, bold: true, color: '#302820' },
      ],
      alignment: 'right',
      lineHeight: 1,
      margin: [0, isCover ? 6 : 0, 0, 0],
    },
    { width: brandWidth, stack: [{ columns: brandColumns, columnGap: 5 }] },
  ];
  const stack: Content[] = [{ columns, columnGap }];
  if (!isCover) {
    stack.push({
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: headerWidth,
          y2: 0,
          lineWidth: 0.5,
          lineColor: '#d9d3cd',
        },
      ],
      margin: [0, 6, 0, 0],
    });
  }
  return { stack, margin: [40, isCover ? 16 : 20, 40, 0] };
}

function headerName(name: string, width: number, fontSize: number): string {
  const characters: string[] = Array.from(name.replace(/\s+/g, ' ').trim());
  const maximumLength: number = Math.min(48, Math.floor(width / fontSize));
  return characters.length <= maximumLength
    ? characters.join('')
    : `${characters
        .slice(0, maximumLength - 1)
        .join('')
        .trimEnd()}…`;
}
