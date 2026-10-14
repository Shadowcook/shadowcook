import type { Translation } from '../../../i18n/types.ts';
import { localizedUnitSymbol } from '../../../i18n/unit-localization.ts';
import type { IngredientUsage } from './types.ts';

export function ingredientAmountText(ingredient: IngredientUsage, text: Translation): string {
  const amount: string | null =
    ingredient.amount === null
      ? null
      : ingredient.amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const unit: string | null =
    ingredient.unit_symbol === null
      ? null
      : localizedUnitSymbol(text, ingredient.unit_translations, ingredient.unit_symbol);
  return [amount, unit]
    .filter((value: string | null): value is string => value !== null && value.length > 0)
    .join(' ');
}

export function specialKindLabel(specialKind: string, text: Translation): string {
  const labels: Record<string, string> = {
    NO_ICON: text.recipeEditor.specialNoIcon,
    REMOVE: text.recipeEditor.specialRemove,
    ADD: text.recipeEditor.specialAdd,
    INFO: text.recipeEditor.specialInfo,
    IMPORTANT: text.recipeEditor.specialImportant,
    COOK: text.recipeEditor.specialCook,
    COOL: text.recipeEditor.specialCool,
    HEAT: text.recipeEditor.specialHeat,
    WAIT: text.recipeEditor.specialWait,
    WORK_STEP: text.recipeEditor.specialWorkStep,
  };
  return labels[specialKind.toUpperCase()] ?? text.recipeEditor.specialEntry;
}
