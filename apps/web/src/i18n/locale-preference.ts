import type { Locale } from './types';

const localeCookieName: string = 'shadowcook_locale';
const localeCookieMaxAge: number = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'de';
}

export function resolveLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : 'en';
}

export function resolveRequestLocale(cookieHeader: string | null, defaultLocale?: string): Locale {
  for (const cookie of cookieHeader?.split(';') ?? []) {
    const separator: number = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== localeCookieName) continue;

    let value: string;
    try {
      value = decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      continue;
    }
    if (isLocale(value)) return value;
  }
  return resolveLocale(defaultLocale);
}

export function localePreferenceCookie(locale: Locale, secure: boolean): string {
  return `${localeCookieName}=${locale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
