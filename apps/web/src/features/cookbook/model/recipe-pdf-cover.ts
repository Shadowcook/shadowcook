import type { Column, Content, ContentText } from 'pdfmake/interfaces';
import type { Translation } from '../../../i18n/types.ts';
import { aggregateShoppingList, formatShoppingListAmount } from './shopping-list.ts';
import type { AggregatedAmount, ShoppingListItem } from './shopping-list.ts';
import type { RecipeDetail, RecipeVariant } from './types.ts';
import { createRecipePdfDiet } from './recipe-pdf-diet.ts';

const coverWidth: number = 515.28;

export function createRecipePdfCover(
  recipe: RecipeDetail,
  text: Translation,
  imageDataUrl?: string,
): Content[] {
  const items: ShoppingListItem[] = aggregateShoppingList(recipe);
  const content: Content[] = [
    { text: recipe.cookbook_name, style: 'coverCookbook' },
    { text: recipe.title, style: 'coverTitle' },
    ...createRecipePdfDiet(recipe.diet, text),
  ];
  content.push({
    text: `${text.recipeEditor.version} ${recipe.version}`,
    fontSize: 10,
    color: '#685b52',
    margin: [0, 0, 0, 12],
  });
  if (recipe.creator_display_name !== null && recipe.creator_display_name !== undefined) {
    content.push({
      text: `${text.recipePdf.createdBy}: ${recipe.creator_display_name}`,
      fontSize: 11,
      color: '#685b52',
      margin: [0, 0, 0, 8],
    });
  }
  const variant: RecipeVariant | undefined = recipe.variants.find(
    (candidate: RecipeVariant): boolean => candidate.slug === recipe.selectedVariant,
  );
  if (variant !== undefined && !variant.is_default) {
    content.push({
      text: `${text.recipeEditor.variant}: ${variant.name}`,
      color: '#685b52',
      margin: [0, 0, 0, 8],
    });
  }

  const imageHeight: number = items.length > 30 ? 100 : 160;
  if (imageDataUrl !== undefined) {
    content.push({
      image: imageDataUrl,
      fit: [coverWidth, 240],
      alignment: 'center',
      margin: [0, 12, 0, 22],
    });
  } else {
    content.push({
      canvas: [{ type: 'rect', x: 0, y: 0, w: coverWidth, h: imageHeight, r: 4, color: '#f4eee6' }],
      margin: [0, 12, 0, 22],
    });
  }

  if (recipe.summary !== null && recipe.summary.length > 0) {
    content.push({ text: recipe.summary, fontSize: 11, margin: [0, 0, 0, 22] });
  }
  if (items.length > 0) {
    const columnCount: number = items.length > 30 ? 3 : items.length > 12 ? 2 : 1;
    const itemsPerColumn: number = Math.ceil(items.length / columnCount);
    const columns: Column[] = [];
    for (let index: number = 0; index < columnCount; index += 1) {
      columns.push({
        width: '*',
        ul: items
          .slice(index * itemsPerColumn, (index + 1) * itemsPerColumn)
          .map((item: ShoppingListItem): ContentText => shoppingListContent(item, text)),
        fontSize: columnCount === 3 ? 9 : 10,
      });
    }
    content.push({ text: text.dashboard.shoppingList, style: 'heading' });
    content.push({ columns, columnGap: 20, margin: [0, 0, 0, 12] });
  }
  return content;
}

function shoppingListContent(item: ShoppingListItem, text: Translation): ContentText {
  const quantities: string[] = Array.from(item.amountsByUnit.values())
    .map((amount: AggregatedAmount): string => formatShoppingListAmount(amount, text))
    .filter((amount: string): boolean => amount.length > 0);
  return {
    text: [
      { text: `${quantities.join(', ')}${quantities.length > 0 ? ' ' : ''}` },
      { text: item.ingredient.ingredient_name, bold: true },
      ...(item.ingredient.is_optional
        ? [{ text: ` (${text.dashboard.optional})`, italics: true }]
        : []),
    ],
    margin: [0, 0, 0, 5],
  };
}
