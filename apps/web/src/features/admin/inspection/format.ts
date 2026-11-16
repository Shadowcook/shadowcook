import type { Locale } from '../../../i18n/types';

/** Preserve PostgreSQL decimal precision while omitting insignificant fraction zeroes. */
export function formatInspectionAmount(value: string, locale: Locale): string {
  const normalized: string = value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
  return locale === 'de' ? normalized.replace('.', ',') : normalized;
}
