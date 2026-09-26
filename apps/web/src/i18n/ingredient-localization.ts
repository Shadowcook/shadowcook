import type { Translation } from './types';

export function localizedIngredientName(
  text: Translation,
  localizationKey: string | null,
  fallback: string,
): string {
  return localizationKey === null ? fallback : (text.ingredients[localizationKey] ?? fallback);
}
