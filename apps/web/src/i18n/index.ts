import { de } from './de';
import { en } from './en';
import type { Locale, Translation } from './types';

export type { Locale, Translation } from './types';
export { resolveLocale } from './locale-preference';

export const translations: Record<Locale, Translation> = {
  de,
  en,
};
