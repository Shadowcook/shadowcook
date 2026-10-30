import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { aggregateShoppingList, formatShoppingListAmount } from '../model/shopping-list';
import type { AggregatedAmount, ShoppingListItem } from '../model/shopping-list';
import type { RecipeDetail } from '../model/types';

interface RecipeShoppingListProperties {
  recipe: RecipeDetail;
  text: Translation;
}

export default function RecipeShoppingList({
  recipe,
  text,
}: RecipeShoppingListProperties): JSX.Element {
  const items: ShoppingListItem[] = aggregateShoppingList(recipe);

  return (
    <aside className="recipe-shopping-list" aria-label={text.dashboard.shoppingList}>
      <p className="eyebrow">{text.dashboard.shoppingList}</p>
      <ul>
        {items.map((item: ShoppingListItem): JSX.Element => {
          const ingredientName: string = item.ingredient.ingredient_name;
          const quantities: string[] = Array.from(item.amountsByUnit.values())
            .map((amount: AggregatedAmount): string => formatShoppingListAmount(amount, text))
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
