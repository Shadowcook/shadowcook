import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';
import type { Translation } from '../../../i18n/types.ts';
import type { RecipeDetail } from './types.ts';
import { createRecipePdfDefinition, recipePdfFilename } from './recipe-pdf.ts';
import type { RecipePdfLinkContext } from './recipe-pdf.ts';
import { loadRecipePdfLogo } from './recipe-pdf-logo.ts';

pdfMake.addVirtualFileSystem(pdfFonts);

export async function downloadRecipePdf(
  recipe: RecipeDetail,
  text: Translation,
  tenantSlug?: string,
): Promise<void> {
  const linkContext: RecipePdfLinkContext | undefined =
    tenantSlug === undefined ? undefined : { tenantSlug, origin: window.location.origin };
  const logoDataUrl: string = await loadRecipePdfLogo();
  const content: Blob = await pdfMake
    .createPdf(createRecipePdfDefinition(recipe, text, linkContext, logoDataUrl))
    .getBlob();
  const url: string = URL.createObjectURL(content);
  const link: HTMLAnchorElement = document.createElement('a');
  try {
    link.href = url;
    link.download = recipePdfFilename(recipe);
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout((): void => URL.revokeObjectURL(url), 1000);
  }
}
