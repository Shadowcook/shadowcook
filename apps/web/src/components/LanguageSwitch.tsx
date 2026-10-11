import type { JSX } from 'react';
import { faLanguage } from '@fortawesome/free-solid-svg-icons';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import { isLocale, localePreferenceCookie } from '../i18n/locale-preference';
import HeadBarDropdown from './HeadBarDropdown';

interface Properties {
  locale: Locale;
}

export default function LanguageSwitch({ locale }: Properties): JSX.Element {
  const text: Translation = translations[locale];

  function changeLanguage(selectedLocale: string): void {
    if (!isLocale(selectedLocale) || selectedLocale === locale) return;

    document.cookie = localePreferenceCookie(selectedLocale, window.location.protocol === 'https:');
    window.location.reload();
  }

  return (
    <HeadBarDropdown label={text.languageSwitch.label} icon={faLanguage}>
      <button
        type="button"
        lang="en"
        aria-pressed={locale === 'en'}
        onClick={(): void => changeLanguage('en')}
      >
        {text.languageSwitch.english}
      </button>
      <button
        type="button"
        lang="de"
        aria-pressed={locale === 'de'}
        onClick={(): void => changeLanguage('de')}
      >
        {text.languageSwitch.german}
      </button>
    </HeadBarDropdown>
  );
}
