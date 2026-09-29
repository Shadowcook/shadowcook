import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { localizedIngredientName } from '../../../i18n/ingredient-localization';
import { localizedUnitSymbol } from '../../../i18n/unit-localization';
import type { IngredientUsage, RecipeDetail } from '../model/types';

interface RecipeShoppingListProperties {
  recipe: RecipeDetail;
  text: Translation;
}

interface ShoppingListItem {
  key: string;
  ingredient: IngredientUsage;
  amountsByUnit: Map<string, AggregatedAmount>;
}

interface AggregatedAmount {
  amount: string | null;
  unitSymbol: string | null;
  unitLocalizationKey: string | null;
}

export default function RecipeShoppingList({
  recipe,
  text,
}: RecipeShoppingListProperties): JSX.Element {
  const items: ShoppingListItem[] = aggregateIngredients(recipe);

  return (
    <aside className="recipe-shopping-list" aria-label={text.dashboard.shoppingList}>
      <p className="eyebrow">{text.dashboard.shoppingList}</p>
      <ul>
        {items.map((item: ShoppingListItem): JSX.Element => {
          const ingredientName: string = localizedIngredientName(
            text,
            item.ingredient.ingredient_localization_key,
            item.ingredient.ingredient_name,
          );
          const quantities: string[] = Array.from(item.amountsByUnit.values())
            .map((amount: AggregatedAmount): string => formatAmount(amount, text))
            .filter((amount: string): boolean => amount.length > 0);

          return (
            <li key={item.key}>
              <span>
                {ingredientName}
                {item.ingredient.is_optional ? <em>{text.dashboard.optional}</em> : null}
              </span>
              {quantities.length > 0 ? <strong>{quantities.join(', ')}</strong> : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function aggregateIngredients(recipe: RecipeDetail): ShoppingListItem[] {
  const itemsByKey: Map<string, ShoppingListItem> = new Map();

  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      if (ingredient.special_kind !== null) continue;

      const ingredientKey: string = shoppingListIngredientKey(ingredient);
      let item: ShoppingListItem | undefined = itemsByKey.get(ingredientKey);
      if (item === undefined) {
        item = {
          key: ingredientKey,
          ingredient,
          amountsByUnit: new Map(),
        };
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

function shoppingListIngredientKey(ingredient: IngredientUsage): string {
  const optionality: string = ingredient.is_optional ? 'optional' : 'required';
  if (ingredient.ingredient_public_id !== null)
    return `${optionality}:catalogue:${ingredient.ingredient_public_id}`;
  return `${optionality}:text:${ingredient.ingredient_name.trim().toLocaleLowerCase()}`;
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

function formatAmount(amount: AggregatedAmount, text: Translation): string {
  if (amount.amount === null) return '';
  const displayAmount: string = amount.amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const unit: string | null =
    amount.unitSymbol === null
      ? null
      : localizedUnitSymbol(text, amount.unitLocalizationKey, amount.unitSymbol);
  return unit === null ? displayAmount : `${displayAmount} ${unit}`;
}
