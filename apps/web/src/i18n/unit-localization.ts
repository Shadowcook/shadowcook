import type { Translation } from './types';

export function localizedUnitName(
  text: Translation,
  localizationKey: string | null,
  fallback: string,
): string {
  return localizationKey === null ? fallback : (text.units[localizationKey]?.name ?? fallback);
}

export function localizedUnitSymbol(
  text: Translation,
  localizationKey: string | null,
  fallback: string,
): string {
  return localizationKey === null ? fallback : (text.units[localizationKey]?.symbol ?? fallback);
}
