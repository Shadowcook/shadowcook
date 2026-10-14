import type { Content } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import { recipePdfSourceUrl } from './recipe-pdf-links.ts';
import type { RecipePdfLinkContext } from './recipe-pdf-links.ts';
import type { RecipeContributor, RecipeDetail } from './types.ts';

export function createRecipePdfCredits(
  recipe: RecipeDetail,
  text: Translation,
  linkContext?: RecipePdfLinkContext,
): Content[] {
  const content: Content[] = [];
  const contributors: RecipeContributor[] = recipe.contributors ?? [];
  if (contributors.length > 0) {
    content.push({
      text: text.dashboard.contributors,
      fontSize: 10,
      bold: true,
      color: '#685b52',
      margin: [0, 16, 0, 6],
    });
    content.push({
      text: contributors
        .map((contributor: RecipeContributor): string => contributor.display_name)
        .join(' · '),
      fontSize: 9,
      color: '#685b52',
    });
  }
  if (linkContext !== undefined) {
    const url: string = recipePdfSourceUrl(recipe, linkContext);
    content.push({
      stack: [
        { text: text.recipePdf.recipeLink, bold: true, color: '#685b52', margin: [0, 0, 0, 4] },
        { text: url, link: url, color: '#5b6242', decoration: 'underline' },
      ],
      fontSize: 9,
      margin: [0, 12, 0, 0],
      unbreakable: true,
    });
  }
  return content;
}
