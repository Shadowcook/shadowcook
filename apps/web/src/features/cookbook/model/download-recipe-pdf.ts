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
  let imageDataUrl: string | undefined;
  if (recipe.image_url) {
    const response: Response = await fetch(recipe.image_url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('PDF_IMAGE_LOAD_FAILED');
    const bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
    let binary: string = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    imageDataUrl = `data:image/jpeg;base64,${btoa(binary)}`;
  }
  const content: Blob = await pdfMake
    .createPdf(createRecipePdfDefinition(recipe, text, linkContext, logoDataUrl, imageDataUrl))
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
