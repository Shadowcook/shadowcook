import assert from 'node:assert/strict';
import test from 'node:test';
import { localePreferenceCookie, resolveRequestLocale } from '../../src/i18n/locale-preference.ts';
import type { Locale } from '../../src/i18n/types.ts';

test('the language preference overrides the build default without an authentication cookie', (): void => {
  assert.equal(resolveRequestLocale('shadowcook_locale=de', 'en'), 'de');
  assert.equal(resolveRequestLocale('shadowcook_locale=en', 'de'), 'en');
  assert.equal(
    resolveRequestLocale('other=value; shadowcook_locale=de; session=token', 'en'),
    'de',
  );
  assert.equal(resolveRequestLocale('session=token; shadowcook_locale=en', 'de'), 'en');
});

test('missing, malformed, and unsupported preferences use the configured default', (): void => {
  for (const cookie of [
    null,
    '',
    'session=token',
    'shadowcook_locale=',
    'shadowcook_locale=fr',
    'shadowcook_locale=DE',
    'shadowcook_locale=%invalid',
    'shadowcook_locale',
    'other_shadowcook_locale=de',
    'other=shadowcook_locale=de',
  ]) {
    assert.equal(resolveRequestLocale(cookie, 'de'), 'de', cookie ?? 'no cookies');
    assert.equal(resolveRequestLocale(cookie), 'en', cookie ?? 'no cookies');
    assert.equal(resolveRequestLocale(cookie, 'unsupported'), 'en', cookie ?? 'no cookies');
  }
  assert.equal(resolveRequestLocale(' other=value; shadowcook_locale=%64%65 '), 'de');
});

test('the language cookie persists for a year across paths and is secure on HTTPS', (): void => {
  const locales: Locale[] = ['en', 'de'];
  for (const locale of locales) {
    const cookie: string = localePreferenceCookie(locale, false);
    assert.equal(cookie, `shadowcook_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
    assert.equal(localePreferenceCookie(locale, true), `${cookie}; Secure`);
    assert.equal(resolveRequestLocale(cookie), locale);
  }
});
