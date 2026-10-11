import type { ChangeEvent, JSX } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { isLocale, localePreferenceCookie } from '../i18n/locale-preference';

interface Properties {
  locale: Locale;
}

export default function LanguageSwitch({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];

  function changeLanguage(event: ChangeEvent<HTMLSelectElement>): void {
    const selectedLocale: string = event.currentTarget.value;
    if (!isLocale(selectedLocale) || selectedLocale === locale) return;

    document.cookie = localePreferenceCookie(selectedLocale, window.location.protocol === 'https:');
    window.location.reload();
  }

  return (
    <select
      className="head-bar__language-switch"
      aria-label={text.languageSwitch.label}
      value={locale}
      onChange={changeLanguage}
    >
      <option value="en" lang="en">
        {text.languageSwitch.english}
      </option>
      <option value="de" lang="de">
        {text.languageSwitch.german}
      </option>
    </select>
  );
}
