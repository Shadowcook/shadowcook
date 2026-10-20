import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TestContext } from 'node:test';
import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';
import { faEgg, faLeaf } from '@fortawesome/free-solid-svg-icons';
import type {
  CanvasElement,
  Content,
  Column,
  ContextPageSize,
  DynamicContent,
  Node as PdfNode,
  NodeQueries,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
import {
  createRecipePdfDefinition,
  recipePdfFilename,
} from '../../src/features/cookbook/model/recipe-pdf.ts';
import { downloadRecipePdf } from '../../src/features/cookbook/model/download-recipe-pdf.ts';
import { loadRecipePdfLogo } from '../../src/features/cookbook/model/recipe-pdf-logo.ts';
import { createRecipePdfHeader } from '../../src/features/cookbook/model/recipe-pdf-header.ts';
import { createRecipePdfCover } from '../../src/features/cookbook/model/recipe-pdf-cover.ts';
import type { RecipeDiet } from '../../src/features/cookbook/model/recipe-metadata.ts';
import { recipePdfSourceUrl } from '../../src/features/cookbook/model/recipe-pdf-links.ts';
import type { RecipePdfLinkContext } from '../../src/features/cookbook/model/recipe-pdf-links.ts';
import type { IngredientUsage, RecipeDetail } from '../../src/features/cookbook/model/types.ts';
import { pdfRecipeFixture } from '../fixtures/pdf-recipe.ts';

pdfMake.addVirtualFileSystem(pdfFonts);
const logoBytes: Buffer = readFileSync(
  new URL('../../src/assets/shadowcook-logo.png', import.meta.url),
);
const logoDataUrl: string = `data:image/png;base64,${logoBytes.toString('base64')}`;

test('PDF covers render the localized vegan or vegetarian label and matching green icon below the title', async (): Promise<void> => {
  for (const text of [en, de]) {
    for (const diet of ['VEGAN', 'VEGETARIAN'] as const) {
      const recipe: RecipeDetail = { ...pdfRecipeFixture(), diet };
      const cover: Content[] = createRecipePdfCover(recipe, text);
      const badge: Content | undefined = cover[2];
      assert.ok(typeof badge === 'object' && 'columns' in badge);
      const symbol: Column | undefined = badge.columns[0];
      const label: Column | undefined = badge.columns[1];
      assert.ok(typeof symbol === 'object' && 'svg' in symbol);
      assert.ok(typeof label === 'object' && 'text' in label);
      assert.equal(label.text, text.recipeMetadata.diets[diet]);
      assert.equal(label.color, '#28723b');
      assert.ok(symbol.svg.includes('fill="#28723b"'));
      const path: string | string[] = (diet === 'VEGAN' ? faLeaf : faEgg).icon[4];
      assert.ok(symbol.svg.includes(typeof path === 'string' ? path : path[0]!));

      const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, text);
      const labelPages: number[] = [];
      const paginate: NonNullable<TDocumentDefinitions['pageBreakBefore']> =
        definition.pageBreakBefore!;
      definition.pageBreakBefore = (node: PdfNode, queries: NodeQueries): boolean => {
        if (node.text === text.recipeMetadata.diets[diet]) labelPages.push(...node.pageNumbers);
        return paginate(node, queries);
      };
      const buffer: Buffer = await pdfMake.createPdf(definition).getBuffer();
      assert.ok(buffer.length > 1000);
      assert.ok(labelPages.includes(1));
    }
  }
});

test('PDF covers omit diet badges for omnivorous and unclassified recipes', (): void => {
  for (const diet of ['OMNI', null] as (RecipeDiet | null)[]) {
    const recipe: RecipeDetail = { ...pdfRecipeFixture(), diet };
    const cover: Content[] = createRecipePdfCover(recipe, en);
    assert.ok(!JSON.stringify(cover).includes('<svg'));
    assert.ok(!JSON.stringify(cover).includes('"color":"#28723b"'));
  }
});

test('PDF content retains authored text and resolves units, notes, quantities, and recipe links', (): void => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, de, {
    tenantSlug: '@ursula',
    origin: 'https://cookbook.example',
  });
  const serialized: string = JSON.stringify(definition.content);
  assert.equal(definition.info?.title, recipe.title);
  assert.equal(definition.info?.author, 'Ursula Müller');
  assert.equal(definition.info?.subject, 'Kochbuch: Ursulas Familienküche · Version 7');
  assert.ok(serialized.includes('"text":"Ursulas Familienküche","style":"coverCookbook"'));
  assert.ok(serialized.includes('Version 7'));
  assert.ok(serialized.includes('Rezept von: Ursula Müller'));
  assert.ok(serialized.includes('Käsekuchen mit süßen Früchten'));
  assert.ok(serialized.includes('Ohne Zucker'));
  assert.ok(serialized.includes('Einkaufsliste'));
  assert.ok(serialized.includes('250 g '));
  assert.ok(serialized.includes('125.5 g '));
  assert.ok(serialized.includes('2 TL '));
  assert.ok(serialized.includes('gesiebt'));
  assert.ok(serialized.includes('nach Geschmack'));
  assert.ok(serialized.includes('(optional)'));
  assert.ok(!serialized.includes(de.recipeEditor.specialCool));
  assert.ok(serialized.includes('<svg'));
  assert.ok(serialized.includes('Mindestens 30 Minuten abkühlen lassen.'));
  assert.ok(serialized.includes('Vanillesoße'));
  assert.ok(serialized.includes('https://cookbook.example/%40ursula/recipes/vanillesosse'));
  assert.ok(!serialized.includes('{recipe:'));
  assert.ok(!serialized.includes('.0000'));
  assert.ok(serialized.includes(JSON.stringify(recipe.steps[0]!.instruction)));
  const english: string = JSON.stringify(createRecipePdfDefinition(recipe, en).content);
  assert.ok(english.includes('Shopping list'));
  assert.ok(english.includes('2 tsp '));
  assert.ok(english.includes('Käsekuchen mit süßen Früchten'));
  assert.ok(english.includes('gesiebt'));
});

test('recipe headers place the large title above the smaller muted cookbook name on every page', (): void => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.title = 'Käsekuchen';
  for (const page of [1, 2]) {
    const header: Content = createRecipePdfHeader(recipe, en, page, true);
    assert.ok(typeof header === 'object' && 'stack' in header);
    const row: Content | undefined = header.stack[0];
    assert.ok(typeof row === 'object' && 'columns' in row);
    const metadata: Column | undefined = row.columns[0];
    const branding: Column | undefined = row.columns[2];
    assert.ok(typeof metadata === 'object' && 'stack' in metadata);
    assert.ok(typeof branding === 'object' && 'stack' in branding);
    const title: Content | undefined = metadata.stack[0];
    const cookbook: Content | undefined = metadata.stack[1];
    const brandRow: Content | undefined = branding.stack[0];
    assert.ok(typeof title === 'object' && 'text' in title);
    assert.ok(typeof cookbook === 'object' && 'text' in cookbook);
    assert.ok(typeof brandRow === 'object' && 'columns' in brandRow);
    const wordmark: Column | undefined = brandRow.columns[1];
    assert.ok(typeof wordmark === 'object' && 'text' in wordmark);
    assert.equal(title.text, recipe.title);
    assert.equal(title.fontSize, page === 1 ? 16 : 12);
    assert.equal(title.bold, true);
    assert.equal(title.color, '#302820');
    assert.equal(cookbook.text, recipe.cookbook_name);
    assert.equal(cookbook.fontSize, 9);
    assert.equal(cookbook.bold, undefined);
    assert.equal(cookbook.color, '#685b52');
    assert.equal(wordmark.text, en.brandName);
    assert.ok((cookbook.fontSize ?? 0) > (wordmark.fontSize ?? 0));
    assert.equal(wordmark.bold, undefined);
  }
});

test('the cover keeps recipe metadata and one-, two-, or three-column shopping lists on page one', async (): Promise<void> => {
  for (const itemCount of [2, 20, 45]) {
    const recipe: RecipeDetail = pdfRecipeFixture();
    const ingredient: IngredientUsage = recipe.steps[0]!.ingredients[0]!;
    const names: string[] = Array.from(
      { length: itemCount },
      (_value: unknown, index: number): string => `Zutat ${String(index + 1).padStart(3, '0')}`,
    );
    recipe.steps = [
      {
        ...recipe.steps[0]!,
        ingredients: names.map((name: string, index: number): IngredientUsage => ({
          ...ingredient,
          ingredient_public_id: `ingredient-${index}`,
          ingredient_name: name,
          sort_order: index,
        })),
      },
    ];
    const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, de);
    const onCover: Set<string> = new Set<string>();
    let preparationPage: number | undefined;
    let titlePage: number | undefined;
    let cookbookPage: number | undefined;
    let authorPage: number | undefined;
    let summaryPage: number | undefined;
    let columnCount: number | undefined;
    definition.pageBreakBefore = (node: PdfNode): boolean => {
      if (node.style === 'coverTitle') titlePage = node.pageNumbers[0];
      if (node.style === 'coverCookbook') cookbookPage = node.pageNumbers[0];
      if (node.text === 'Rezept von: Ursula Müller') authorPage = node.pageNumbers[0];
      if (node.text === recipe.summary) summaryPage = node.pageNumbers[0];
      if (node.text === `${de.dashboard.step} 1`) preparationPage = node.pageNumbers[0];
      if (node.pageNumbers.includes(1)) {
        if (
          node.columns !== undefined &&
          node.columns.every(
            (column: Column): boolean =>
              typeof column === 'object' && column !== null && 'ul' in column,
          )
        )
          columnCount = node.columns.length;
        const renderedText: string = JSON.stringify(node.text) ?? '';
        for (const name of names) {
          if (renderedText.includes(name)) onCover.add(name);
        }
      }
      return false;
    };
    await pdfMake.createPdf(definition).getBuffer();
    assert.equal(titlePage, 1);
    assert.equal(cookbookPage, 1);
    assert.equal(authorPage, 1);
    assert.equal(summaryPage, 1);
    assert.equal(preparationPage, 2);
    assert.equal(onCover.size, itemCount);
    assert.equal(columnCount, itemCount > 30 ? 3 : itemCount > 12 ? 2 : 1);
  }
});

test('a cover without a creator, shopping ingredients, or steps remains a single page', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.creator_display_name = null;
  recipe.steps = [];
  const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, en);
  assert.equal(definition.info?.author, undefined);
  assert.ok(!JSON.stringify(definition.content).includes(en.recipePdf.createdBy));
  const buffer: Buffer = await pdfMake.createPdf(definition).getBuffer();
  assert.equal(Array.from(buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)).length, 1);
});

test('the embedded application logo and localized wordmark repeat on every PDF page without covering preparation', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.title = 'Käsekuchen';
  recipe.steps[0]!.instruction = 'Gründlich verrühren und abkühlen lassen.\n'.repeat(140);
  const definition: TDocumentDefinitions = createRecipePdfDefinition(
    recipe,
    de,
    undefined,
    logoDataUrl,
  );
  assert.equal(definition.images?.shadowcookLogo, logoDataUrl);
  assert.ok(typeof definition.header === 'function');
  const header: DynamicContent = definition.header;
  const headerPages: number[] = [];
  definition.header = (
    page: number,
    pageCount: number,
    size: ContextPageSize,
  ): Content | null | undefined => {
    headerPages.push(page);
    const content: Content | null | undefined = header(page, pageCount, size);
    const serialized: string = JSON.stringify(content);
    assert.ok(serialized.includes(de.brandName));
    assert.ok(serialized.includes('shadowcookLogo'));
    assert.ok(serialized.includes(recipe.cookbook_name));
    assert.ok(serialized.includes(recipe.title));
    assert.ok(serialized.includes(de.recipeEditor.version));
    assert.ok(serialized.includes('"text":"7"'));
    return content;
  };
  definition.pageBreakBefore = (node: PdfNode): boolean => {
    if (typeof node.text === 'string' && node.text.startsWith(`${de.dashboard.step} `)) {
      assert.ok(node.startPosition.top >= 64);
    }
    return false;
  };
  const buffer: Buffer = await pdfMake.createPdf(definition).getBuffer();
  const pageCount: number = Array.from(
    buffer.toString('latin1').matchAll(/\/Type \/Page\b/g),
  ).length;
  assert.ok(pageCount >= 4);
  assert.deepEqual(
    headerPages,
    Array.from({ length: pageCount }, (_value: unknown, index: number): number => index + 1),
  );
  assert.ok(buffer.toString('latin1').includes('/Subtype /Image'));
});

test('long cookbook and recipe names fit within the repeating header and remain complete on the cover', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.cookbook_name = 'W'.repeat(160);
  recipe.title = 'W'.repeat(240);
  recipe.version = 2147483647;
  const definition: TDocumentDefinitions = createRecipePdfDefinition(
    recipe,
    en,
    undefined,
    logoDataUrl,
  );
  assert.ok(JSON.stringify(definition.content).includes(recipe.title));
  assert.ok(JSON.stringify(definition.content).includes(recipe.cookbook_name));
  assert.ok(typeof definition.header === 'function');
  const header: DynamicContent = definition.header;
  definition.header = (
    page: number,
    pageCount: number,
    size: ContextPageSize,
  ): Content | null | undefined => {
    const content: Content | null | undefined = header(page, pageCount, size);
    const serialized: string = JSON.stringify(content);
    assert.ok(serialized.includes('…'));
    assert.ok(serialized.includes('2147483647'));
    assert.ok(!serialized.includes(recipe.title));
    return content;
  };
  definition.pageBreakBefore = (node: PdfNode): boolean => {
    node.canvas?.forEach((element: CanvasElement): void => {
      if (element.type !== 'line') return;
      assert.ok(element.y1 >= 0 && element.y1 < 64);
      assert.ok(element.y2 >= 0 && element.y2 < 64);
    });
    return false;
  };
  await pdfMake.createPdf(definition).getBuffer();
});

test('failed logo requests and HTML redirects cannot become embedded PDF assets', async (context: TestContext): Promise<void> => {
  for (const status of [200, 404]) {
    context.mock.method(
      globalThis,
      'fetch',
      async (): Promise<Response> =>
        new Response('<html>Not a logo</html>', {
          status,
          headers: { 'content-type': 'text/html' },
        }),
    );
    await assert.rejects(loadRecipePdfLogo(), /PDF_LOGO_LOAD_FAILED/);
  }
});

test('contributor credits render after preparation, stay off the cover, and are localized', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  const linkContext: RecipePdfLinkContext = {
    tenantSlug: '@ursula',
    origin: 'https://cookbook.example',
  };
  const sourceUrl: string = 'https://cookbook.example/%40ursula/recipes/kaesekuchen/ohne-zucker';
  for (const text of [de, en]) {
    const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, text, linkContext);
    let creditPage: number | undefined;
    let creditTop: number | undefined;
    let lastStepTop: number | undefined;
    let sourcePage: number | undefined;
    let sourceTop: number | undefined;
    definition.pageBreakBefore = (node: PdfNode): boolean => {
      if (node.text === text.dashboard.contributors) {
        creditPage = node.pageNumbers[0];
        creditTop = node.startPosition.top;
      }
      if (node.text === `${text.dashboard.step} 2`) lastStepTop = node.startPosition.top;
      if (node.text === text.recipePdf.recipeLink) {
        sourcePage = node.pageNumbers[0];
        sourceTop = node.startPosition.top;
      }
      return false;
    };
    const buffer: Buffer = await pdfMake.createPdf(definition).getBuffer();
    assert.equal(creditPage, 2);
    assert.ok(creditTop !== undefined && lastStepTop !== undefined && creditTop > lastStepTop);
    assert.equal(sourcePage, 2);
    assert.ok(sourceTop !== undefined && creditTop !== undefined && sourceTop > creditTop);
    assert.ok(buffer.toString('latin1').includes(`/URI (${sourceUrl})`));
    assert.ok(JSON.stringify(definition.content).includes('Ursula Müller · Thomas Becker'));
  }
  recipe.contributors = [];
  assert.ok(
    !JSON.stringify(createRecipePdfDefinition(recipe, en).content).includes(
      en.dashboard.contributors,
    ),
  );
  const withoutContributors: string = JSON.stringify(
    createRecipePdfDefinition(recipe, en, linkContext).content,
  );
  assert.ok(withoutContributors.includes(en.recipePdf.recipeLink));
  assert.ok(withoutContributors.includes(`"link":"${sourceUrl}"`));
  assert.ok(
    !JSON.stringify(createRecipePdfDefinition(recipe, en).content).includes(
      en.recipePdf.recipeLink,
    ),
  );
});

test('source links identify the selected variant and encode cookbook, recipe, and variant slugs', (): void => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  const context: RecipePdfLinkContext = {
    tenantSlug: '@ursula',
    origin: 'https://cookbook.example',
  };
  assert.equal(
    recipePdfSourceUrl(recipe, context),
    'https://cookbook.example/%40ursula/recipes/kaesekuchen/ohne-zucker',
  );
  recipe.selectedVariant = 'original';
  assert.equal(
    recipePdfSourceUrl(recipe, context),
    'https://cookbook.example/%40ursula/recipes/kaesekuchen',
  );
  recipe.selectedVariant = 'ohne-zucker';
  recipe.slug = 'kuchen & früchte';
  recipe.variants[1]!.slug = 'süß/sauer';
  recipe.selectedVariant = recipe.variants[1]!.slug;
  assert.equal(
    recipePdfSourceUrl(recipe, context),
    'https://cookbook.example/%40ursula/recipes/kuchen%20%26%20fr%C3%BCchte/s%C3%BC%C3%9F%2Fsauer',
  );
});

test('all special-entry pictograms render as PDF vectors and No Icon retains only its authored note', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  const specialEntry: IngredientUsage = recipe.steps[1]!.ingredients[1]!;
  const kinds: string[] = [
    'ADD',
    'COOL',
    'COOK',
    'HEAT',
    'IMPORTANT',
    'INFO',
    'REMOVE',
    'WAIT',
    'WORK_STEP',
  ];
  recipe.steps = [
    {
      ...recipe.steps[0]!,
      ingredients: [
        ...kinds.map((kind: string, index: number): IngredientUsage => ({
          ...specialEntry,
          sort_order: index,
          special_kind: kind,
          note: `Authored note ${index + 1}`,
        })),
        {
          ...specialEntry,
          sort_order: 9,
          special_kind: 'NO_ICON',
          note: 'Über Nacht ruhen lassen.',
        },
        { ...specialEntry, sort_order: 10, special_kind: 'NO_ICON', note: null },
      ],
    },
  ];
  const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, en);
  const serialized: string = JSON.stringify(definition.content);
  assert.equal(Array.from(serialized.matchAll(/<svg/g)).length, 9);
  assert.ok(serialized.includes('Über Nacht ruhen lassen.'));
  assert.ok(!serialized.includes(en.recipeEditor.specialNoIcon));
  assert.ok(!serialized.includes('NO_ICON'));
  assert.ok(!serialized.includes(en.recipeEditor.specialCool));
  const buffer: Buffer = await pdfMake.createPdf(definition).getBuffer();
  const binary: string = buffer.toString('latin1');
  assert.ok(binary.startsWith('%PDF-'));
  assert.ok(binary.includes('%%EOF'));
  assert.ok(!binary.includes('/Subtype /Image'));
});

test('an instruction longer than one A4 page generates a valid PDF with embedded fonts and multiple pages', async (): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.steps = [
    { ...recipe.steps[0]!, instruction: 'Gründlich verrühren und abkühlen lassen.\n'.repeat(140) },
  ];
  const buffer: Buffer = await pdfMake.createPdf(createRecipePdfDefinition(recipe, de)).getBuffer();
  const binary: string = buffer.toString('latin1');
  assert.ok(binary.startsWith('%PDF-'));
  assert.ok(binary.includes('%%EOF'));
  assert.ok(binary.includes('/FontFile2'));
  assert.ok(Array.from(binary.matchAll(/\/Type \/Page\b/g)).length >= 3);
});

test('PDF filenames identify the selected variant and remove unsafe filename characters', (): void => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  assert.equal(recipePdfFilename(recipe), 'kaesekuchen-ohne-zucker.pdf');
  recipe.selectedVariant = 'original';
  assert.equal(recipePdfFilename(recipe), 'kaesekuchen.pdf');
  recipe.slug = '../unsafe\\recipe:*?"<>|\u0000';
  assert.ok(!/[\u0000/\\:*?"<>|]/.test(recipePdfFilename(recipe)));
});

test('the browser downloads a real PDF and releases its temporary object URL', async (context: TestContext): Promise<void> => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit): Promise<Response> => {
      assert.equal(url, '/shadowcook-logo.png');
      assert.equal(options.credentials, 'same-origin');
      return new Response(new Uint8Array(logoBytes), { headers: { 'content-type': 'image/png' } });
    },
  );
  let appended: boolean = false;
  let clicked: boolean = false;
  let removed: boolean = false;
  let blob: Blob | undefined;
  let cleanup: (() => void) | undefined;
  const anchor: { href: string; download: string; click(): void; remove(): void } = {
    href: '',
    download: '',
    click(): void {
      assert.ok(appended);
      clicked = true;
    },
    remove(): void {
      removed = true;
    },
  };
  const documentDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const windowDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (): typeof anchor => anchor,
      body: {
        append: (): void => {
          appended = true;
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://cookbook.example' },
      setTimeout: (callback: () => void): number => {
        cleanup = callback;
        return 1;
      },
    },
  });
  context.after((): void => {
    if (documentDescriptor !== undefined)
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    if (windowDescriptor !== undefined)
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  context.mock.method(URL, 'createObjectURL', (content: Blob): string => {
    blob = content;
    return 'blob:recipe-pdf';
  });
  const revoke: { mock: { callCount(): number } } = context.mock.method(
    URL,
    'revokeObjectURL',
    (): void => {},
  );
  await downloadRecipePdf(recipe, de, 'ursula');
  assert.ok(clicked);
  assert.ok(removed);
  assert.equal(anchor.download, 'kaesekuchen-ohne-zucker.pdf');
  assert.equal(anchor.href, 'blob:recipe-pdf');
  assert.ok(blob);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(
    Buffer.from(await blob.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  assert.equal(revoke.mock.callCount(), 0);
  assert.ok(cleanup);
  cleanup();
  assert.equal(revoke.mock.callCount(), 1);
});
