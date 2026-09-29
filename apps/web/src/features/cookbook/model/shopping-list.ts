import type { Translation } from '../../../i18n';
import { localizedUnitSymbol } from '../../../i18n/unit-localization';
import type { IngredientUsage, RecipeDetail } from './types';

export interface ShoppingListItem {
  key: string;
  ingredient: IngredientUsage;
  amountsByUnit: Map<string, AggregatedAmount>;
}

export interface AggregatedAmount {
  amount: string | null;
  unitSymbol: string | null;
  unitLocalizationKey: string | null;
}

export function aggregateShoppingList(recipe: RecipeDetail): ShoppingListItem[] {
  const itemsByKey: Map<string, ShoppingListItem> = new Map();

  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      if (ingredient.special_kind !== null) continue;
      if (ingredient.ingredient_public_id === null) continue;

      const ingredientKey: string = shoppingListIngredientKey(
        ingredient.ingredient_public_id,
        ingredient.is_optional,
      );
      let item: ShoppingListItem | undefined = itemsByKey.get(ingredientKey);
      if (item === undefined) {
        item = { key: ingredientKey, ingredient, amountsByUnit: new Map() };
        itemsByKey.set(ingredientKey, item);
      }

      const unitKey: string = ingredient.unit_public_id ?? 'without-unit';
      const current: AggregatedAmount | undefined = item.amountsByUnit.get(unitKey);
      item.amountsByUnit.set(unitKey, {
        amount: combineAmounts(current?.amount ?? null, ingredient.amount),
        unitSymbol: ingredient.unit_symbol,
        unitLocalizationKey: ingredient.unit_localization_key,
      });
    }
  }

  return Array.from(itemsByKey.values()).sort(
    (left: ShoppingListItem, right: ShoppingListItem): number =>
      left.ingredient.ingredient_name.localeCompare(right.ingredient.ingredient_name),
  );
}

export function formatShoppingListAmount(amount: AggregatedAmount, text: Translation): string {
  if (amount.amount === null) return '';
  const displayAmount: string = amount.amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const unit: string | null =
    amount.unitSymbol === null
      ? null
      : localizedUnitSymbol(text, amount.unitLocalizationKey, amount.unitSymbol);
  return unit === null ? displayAmount : `${displayAmount} ${unit}`;
}

function shoppingListIngredientKey(ingredientPublicId: string, isOptional: boolean): string {
  const optionality: string = isOptional ? 'optional' : 'required';
  return `${optionality}:catalogue:${ingredientPublicId}`;
}

function combineAmounts(current: string | null, next: string | null): string | null {
  if (current === null) return next;
  if (next === null) return current;

  const [currentWhole, currentFraction = ''] = current.split('.');
  const [nextWhole, nextFraction = ''] = next.split('.');
  const fractionLength: number = Math.max(currentFraction.length, nextFraction.length);
  const currentValue: bigint = BigInt(
    `${currentWhole}${currentFraction.padEnd(fractionLength, '0')}`,
  );
  const nextValue: bigint = BigInt(`${nextWhole}${nextFraction.padEnd(fractionLength, '0')}`);
  const sum: string = (currentValue + nextValue).toString().padStart(fractionLength + 1, '0');

  if (fractionLength === 0) return sum;
  const whole: string = sum.slice(0, -fractionLength);
  const fraction: string = sum.slice(-fractionLength).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
