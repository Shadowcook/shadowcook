import type { Translation } from './types';

export interface UnitTranslation {
  name: string;
  symbol: string;
}

export type UnitTranslations = Record<string, UnitTranslation>;

export function localizedUnitName(
  text: Translation,
  translations: UnitTranslations,
  fallback: string,
): string {
  return translations[text.locale]?.name ?? fallback;
}

export function localizedUnitSymbol(
  text: Translation,
  translations: UnitTranslations,
  fallback: string,
): string {
  return translations[text.locale]?.symbol ?? fallback;
}
