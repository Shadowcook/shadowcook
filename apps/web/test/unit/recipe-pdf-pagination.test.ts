import assert from 'node:assert/strict';
import test from 'node:test';
import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';
import type { Node, NodeQueries, TCreatedPdf, TDocumentDefinitions } from 'pdfmake/interfaces';
import { createRecipePdfDefinition } from '../../src/features/cookbook/model/recipe-pdf.ts';
import type {
  IngredientUsage,
  RecipeDetail,
  RecipeStep,
} from '../../src/features/cookbook/model/types.ts';
import { de } from '../../src/i18n/de.ts';
import { pdfRecipeFixture } from '../fixtures/pdf-recipe.ts';

interface RenderedRecipe {
  nodes: Node[];
  buffer: Buffer;
  pages: RenderedPage[];
}

interface RenderedPage {
  items: RenderedItem[];
}

interface RenderedItem {
  type: string;
  item: { type?: string; y1?: number; y2?: number; inlines?: { text: string }[] };
}

type RenderedPdfStream = Awaited<ReturnType<TCreatedPdf['getStream']>> & {
  _pdfMakePages: RenderedPage[];
};

pdfMake.addVirtualFileSystem(pdfFonts);

function recipeWithSteps(lineCounts: number[]): RecipeDetail {
  const recipe: RecipeDetail = pdfRecipeFixture();
  const originalStep: RecipeStep = recipe.steps[0]!;
  const originalIngredient: IngredientUsage = originalStep.ingredients[0]!;
  recipe.steps = lineCounts.map((lines: number, index: number): RecipeStep => ({
    ...originalStep,
    public_id: `step-${index + 1}`,
    sort_order: index,
    instruction: `Anleitung ${index + 1}\n${'Gründlich verrühren.\n'.repeat(lines)}Ende ${index + 1}`,
    ingredients: [
      {
        ...originalIngredient,
        ingredient_public_id: `ingredient-${index + 1}`,
        ingredient_name: `Zutat für Schritt ${index + 1}`,
      },
    ],
  }));
  return recipe;
}

async function renderRecipe(recipe: RecipeDetail): Promise<RenderedRecipe> {
  const definition: TDocumentDefinitions = createRecipePdfDefinition(recipe, de, {
    tenantSlug: '@ursula',
    origin: 'https://cookbook.example',
  });
  const paginate: NonNullable<TDocumentDefinitions['pageBreakBefore']> =
    definition.pageBreakBefore!;
  const nodes: Node[] = [];
  definition.pageBreakBefore = (node: Node, queries: NodeQueries): boolean => {
    if (paginate(node, queries)) return true;
    nodes.push(node);
    return false;
  };
  const output: TCreatedPdf = pdfMake.createPdf(definition);
  const stream: RenderedPdfStream = (await output.getStream()) as RenderedPdfStream;
  const buffer: Buffer = await output.getBuffer();
  return { nodes, buffer, pages: stream._pdfMakePages };
}

function tableRulePositions(page: RenderedPage): number[] {
  const positions: Set<number> = new Set<number>();
  page.items.forEach((element: RenderedItem): void => {
    if (
      element.type === 'vector' &&
      element.item.type === 'line' &&
      element.item.y1 !== undefined &&
      element.item.y1 === element.item.y2 &&
      element.item.y1 >= 64
    ) {
      positions.add(element.item.y1);
    }
  });
  return Array.from(positions).sort((left: number, right: number): number => left - right);
}

test('long utensils text flows across PDF pages without truncation', async (): Promise<void> => {
  const recipe: RecipeDetail = recipeWithSteps([2]);
  const utensils: string = `${'Mixing bowl\n'.repeat(160)}Final utensil`;
  recipe.metadata.utensils = utensils;
  const result: RenderedRecipe = await renderRecipe(recipe);
  const textNode: Node = renderedNode(result, utensils);
  assert.ok(textNode.pageNumbers.length > 1);
  const finalPageText: string = result.pages
    .at(-1)!
    .items.flatMap((element: RenderedItem): string[] =>
      (element.item.inlines ?? []).map((inline: { text: string }): string => inline.text),
    )
    .join('');
  assert.ok(finalPageText.includes('Final utensil'));
});

function renderedNode(result: RenderedRecipe, text: string): Node {
  const node: Node | undefined =
    result.nodes.find(
      (candidate: Node): boolean => !candidate.pageNumbers.includes(1) && candidate.text === text,
    ) ??
    result.nodes.find(
      (candidate: Node): boolean =>
        !candidate.pageNumbers.includes(1) && (JSON.stringify(candidate.text) ?? '').includes(text),
    );
  assert.ok(node, `Missing rendered content: ${text}`);
  return node;
}

function assertStepPage(result: RenderedRecipe, step: number, page: number): void {
  const label: Node = renderedNode(result, `${de.dashboard.step} ${step}`);
  const instruction: Node = renderedNode(result, `Anleitung ${step}`);
  const ingredient: Node = renderedNode(result, `Zutat für Schritt ${step}`);
  assert.deepEqual(label.pageNumbers, [page]);
  assert.deepEqual(instruction.pageNumbers, [page]);
  assert.deepEqual(ingredient.pageNumbers, [page]);
  assert.equal(label.startPosition.top, ingredient.startPosition.top);
}

test('steps that fit in the remaining space stay together on the same preparation page', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([2, 3, 2]));
  assertStepPage(result, 1, 2);
  assertStepPage(result, 2, 2);
  assertStepPage(result, 3, 2);
  assert.equal(Array.from(result.buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)).length, 2);
});

test('a fitting step moves both columns to a new page when its instruction would otherwise split', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([22, 22, 2]));
  assertStepPage(result, 1, 2);
  assertStepPage(result, 2, 3);
  assertStepPage(result, 3, 3);
  assert.deepEqual(renderedNode(result, de.dashboard.contributors).pageNumbers, [3]);
  assert.deepEqual(renderedNode(result, de.recipePdf.recipeLink).pageNumbers, [3]);
});

test('moving a step leaves no extra rule in the empty page area or above the column headings', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([22, 22, 2]));
  const firstPageRules: number[] = tableRulePositions(result.pages[1]!);
  const secondPageRules: number[] = tableRulePositions(result.pages[2]!);
  assert.equal(firstPageRules.length, 2);
  assert.equal(secondPageRules.length, 3);
  assert.ok(firstPageRules[0]! > 80);
  assert.ok(secondPageRules[0]! > 80);
});

test('successive page breaks retain only the heading rule and completed-step rule on each page', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([22, 22, 22, 22]));
  result.pages.slice(1).forEach((page: RenderedPage): void => {
    assert.equal(tableRulePositions(page).length, 2);
  });
});

test('oversized steps do not add closing rules until the step actually ends', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([140, 2]));
  const instruction: Node = renderedNode(result, 'Anleitung 1');
  instruction.pageNumbers.slice(0, -1).forEach((page: number): void => {
    assert.equal(tableRulePositions(result.pages[page - 1]!).length, 1);
  });
});

test('a step also moves intact when its ingredients, rather than its instruction, would split', async (): Promise<void> => {
  const recipe: RecipeDetail = recipeWithSteps([22, 2, 2]);
  recipe.steps[1]!.ingredients[0]!.note = 'Gesondert vorbereiten.\n'.repeat(22);
  const result: RenderedRecipe = await renderRecipe(recipe);
  assertStepPage(result, 1, 2);
  assertStepPage(result, 2, 3);
  assertStepPage(result, 3, 3);
});

test('steps without ingredients keep their label and instruction together at page boundaries', async (): Promise<void> => {
  const recipe: RecipeDetail = recipeWithSteps([22, 22, 2]);
  recipe.steps[1]!.ingredients = [];
  const result: RenderedRecipe = await renderRecipe(recipe);
  assertStepPage(result, 1, 2);
  assert.deepEqual(renderedNode(result, `${de.dashboard.step} 2`).pageNumbers, [3]);
  assert.deepEqual(renderedNode(result, 'Anleitung 2').pageNumbers, [3]);
  assertStepPage(result, 3, 3);
});

test('successive steps move to fresh pages without creating blank preparation pages', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([22, 22, 22, 22]));
  for (let step: number = 1; step <= 4; step += 1) assertStepPage(result, step, step + 1);
  assert.equal(Array.from(result.buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)).length, 5);
});

test('an oversized first step spans pages without an unnecessary page break before it', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([140, 2]));
  const instruction: Node = renderedNode(result, 'Anleitung 1');
  assert.equal(instruction.pageNumbers[0], 2);
  assert.ok(instruction.pageNumbers.length >= 3);
  assert.ok(JSON.stringify(instruction.text).includes('Ende 1'));
  const nextPage: number = instruction.pageNumbers.at(-1)!;
  assertStepPage(result, 2, nextPage);
});

test('an oversized later step begins on a fresh page and remains breakable without losing following steps', async (): Promise<void> => {
  const result: RenderedRecipe = await renderRecipe(recipeWithSteps([2, 140, 2]));
  assertStepPage(result, 1, 2);
  const instruction: Node = renderedNode(result, 'Anleitung 2');
  assert.equal(instruction.pageNumbers[0], 3);
  assert.ok(instruction.pageNumbers.length >= 3);
  assert.ok(JSON.stringify(instruction.text).includes('Ende 2'));
  assert.deepEqual(renderedNode(result, 'Zutat für Schritt 2').pageNumbers, [3]);
  const nextPage: number = instruction.pageNumbers.at(-1)!;
  assertStepPage(result, 3, nextPage);
  assert.deepEqual(renderedNode(result, de.dashboard.contributors).pageNumbers, [nextPage]);
});

test('oversized ingredient notes can span pages while the instruction starts alongside them', async (): Promise<void> => {
  const recipe: RecipeDetail = recipeWithSteps([2, 2, 2]);
  recipe.steps[1]!.ingredients[0]!.note = `${'Gesondert vorbereiten.\n'.repeat(140)}Notizende`;
  const result: RenderedRecipe = await renderRecipe(recipe);
  assertStepPage(result, 1, 2);
  const ingredients: Node = renderedNode(result, 'Zutat für Schritt 2');
  assert.equal(ingredients.pageNumbers[0], 3);
  assert.ok(ingredients.pageNumbers.length >= 3);
  assert.ok(JSON.stringify(ingredients.text).includes('Notizende'));
  assert.deepEqual(renderedNode(result, 'Anleitung 2').pageNumbers, [3]);
  assertStepPage(result, 3, ingredients.pageNumbers.at(-1)!);
});
