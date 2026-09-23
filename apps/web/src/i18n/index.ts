import { de } from './de';
import { en } from './en';
import type { Locale, Translation } from './types';

export type { Locale, Translation } from './types';

export const translations: Record<Locale, Translation> = {
  de,
  en,
};

export function resolveLocale(value: string | undefined): Locale {
  return value === 'de' ? 'de' : 'en';
}
