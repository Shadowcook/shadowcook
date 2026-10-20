import type { Content, ContentText, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import { recipePdfIngredientContent } from './recipe-pdf-ingredients.ts';
import { createRecipePdfCover } from './recipe-pdf-cover.ts';
import { createRecipePdfHeader } from './recipe-pdf-header.ts';
import { createRecipePdfCredits } from './recipe-pdf-credits.ts';
import { createRecipePdfMetadata } from './recipe-pdf-metadata.ts';
import { recipePdfLinkUrl } from './recipe-pdf-links.ts';
import type { RecipePdfLinkContext } from './recipe-pdf-links.ts';
import { createRecipePdfStepPagination } from './recipe-pdf-pagination.ts';
import type { RecipePdfStepRow } from './recipe-pdf-pagination.ts';
import { recipePdfTableLayout } from './recipe-pdf-table-layout.ts';
import type {
  IngredientUsage,
  RecipeDetail,
  RecipeLink,
  RecipeStep,
  RecipeVariant,
} from './types.ts';

export type { RecipePdfLinkContext } from './recipe-pdf-links.ts';

export function recipePdfFilename(recipe: RecipeDetail): string {
  const variant: RecipeVariant | undefined = recipe.variants.find(
    (candidate: RecipeVariant): boolean => candidate.slug === recipe.selectedVariant,
  );
  const name: string =
    variant !== undefined && !variant.is_default ? `${recipe.slug}-${variant.slug}` : recipe.slug;
  const safeName: string = name
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .slice(0, 160)
    .replace(/[.\s]+$/g, '');
  return `${safeName || recipe.public_id}.pdf`;
}

export function createRecipePdfDefinition(
  recipe: RecipeDetail,
  text: Translation,
  linkContext?: RecipePdfLinkContext,
  logoDataUrl?: string,
): TDocumentDefinitions {
  const content: Content[] = createRecipePdfCover(recipe, text);
  const stepRows: RecipePdfStepRow[] = recipe.steps.map(
    (step: RecipeStep, index: number): RecipePdfStepRow => [
      {
        stack:
          step.ingredients.length === 0
            ? [{ text: '' }]
            : step.ingredients.map((ingredient: IngredientUsage): Content =>
                recipePdfIngredientContent(ingredient, text),
              ),
      },
      {
        stack: [
          { text: `${text.dashboard.step} ${index + 1}`, bold: true, margin: [0, 0, 0, 6] },
          {
            text: instructionContent(step.instruction, recipe.recipe_links ?? [], linkContext),
            preserveLeadingSpaces: true,
          },
        ],
      },
    ],
  );
  const stepPagination: NonNullable<TDocumentDefinitions['pageBreakBefore']> =
    createRecipePdfStepPagination(stepRows);

  if (stepRows.length > 0) {
    const rows: TableCell[][] = [
      [
        { text: text.dashboard.ingredients, style: 'heading' },
        { text: text.dashboard.preparation, style: 'heading' },
      ],
      ...stepRows,
    ];
    content.push({
      pageBreak: 'before',
      table: { headerRows: 1, widths: ['34%', '*'], body: rows, dontBreakRows: false },
      layout: recipePdfTableLayout,
    });
  }

  content.push(...createRecipePdfCredits(recipe, text, linkContext));
  content.push(...createRecipePdfMetadata(recipe, text));

  return {
    info: {
      title: recipe.title,
      subject: `${text.recipePdf.cookbook}: ${recipe.cookbook_name} · ${text.recipeEditor.version} ${recipe.version}`,
      creator: text.brandName,
      ...(recipe.creator_display_name === null || recipe.creator_display_name === undefined
        ? {}
        : { author: recipe.creator_display_name }),
    },
    pageSize: 'A4',
    pageMargins: [40, 64, 40, 48],
    pageBreakBefore: stepPagination,
    images: logoDataUrl === undefined ? {} : { shadowcookLogo: logoDataUrl },
    header: (currentPage: number): Content =>
      createRecipePdfHeader(recipe, text, currentPage, logoDataUrl !== undefined),
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: '#302820' },
    styles: {
      coverCookbook: { fontSize: 18, bold: true, color: '#5b6242', margin: [0, 0, 0, 10] },
      coverTitle: { fontSize: 30, bold: true, lineHeight: 1.1, margin: [0, 0, 0, 12] },
      heading: { fontSize: 12, bold: true, margin: [0, 0, 0, 8] },
    },
    content,
    footer: (currentPage: number, pageCount: number): ContentText => ({
      text: `${text.dashboard.page} ${currentPage} / ${pageCount}`,
      alignment: 'right',
      fontSize: 8,
      color: '#685b52',
      margin: [40, 14, 40, 0],
    }),
  };
}

function instructionContent(
  instruction: string,
  recipeLinks: RecipeLink[],
  linkContext?: RecipePdfLinkContext,
): ContentText[] {
  const pattern: RegExp =
    /\{recipe:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}/gi;
  const linksById: Map<string, RecipeLink> = new Map(
    recipeLinks.map((link: RecipeLink): [string, RecipeLink] => [
      link.public_id.toLowerCase(),
      link,
    ]),
  );
  const parts: ContentText[] = [];
  let cursor: number = 0;
  for (const match of instruction.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: instruction.slice(cursor, match.index) });
    const reference: RecipeLink | undefined = linksById.get(match[1]!.toLowerCase());
    if (reference === undefined) {
      parts.push({ text: match[0] });
    } else {
      const linkedText: ContentText = { text: reference.title };
      if (linkContext !== undefined) {
        linkedText.link = recipePdfLinkUrl(reference.slug, linkContext);
        linkedText.color = '#5b6242';
        linkedText.decoration = 'underline';
      }
      parts.push(linkedText);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < instruction.length) parts.push({ text: instruction.slice(cursor) });
  return parts.length === 0 ? [{ text: '' }] : parts;
}
