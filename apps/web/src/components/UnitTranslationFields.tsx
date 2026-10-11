import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../i18n';
import type { UnitTranslation, UnitTranslations } from '../i18n/unit-localization';

interface UnitTranslationFieldsProperties {
  text: Translation;
  name: string;
  symbol: string;
  translations: UnitTranslations;
  onDefaultChange: (field: 'name' | 'symbol', value: string) => void;
  onTranslationsChange: (translations: UnitTranslations) => void;
}

export default function UnitTranslationFields(
  properties: UnitTranslationFieldsProperties,
): JSX.Element {
  const [newLocale, setNewLocale] = useState<string>('');
  const locales: string[] = ['en', ...Object.keys(properties.translations).sort()];
  const locale: string = newLocale.trim().toLowerCase();
  const canAdd: boolean =
    /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/.test(locale) &&
    !locales.includes(locale) &&
    locales.length <= 50;
  const languageNames: Intl.DisplayNames = new Intl.DisplayNames([properties.text.locale], {
    type: 'language',
  });

  function update(language: string, field: 'name' | 'symbol', value: string): void {
    if (language === 'en') {
      properties.onDefaultChange(field, value);
      return;
    }
    properties.onTranslationsChange({
      ...properties.translations,
      [language]: { ...properties.translations[language], [field]: value },
    });
  }

  function remove(language: string): void {
    const updated: UnitTranslations = { ...properties.translations };
    delete updated[language];
    properties.onTranslationsChange(updated);
  }

  function add(): void {
    if (!canAdd) return;
    properties.onTranslationsChange({
      ...properties.translations,
      [locale]: { name: '', symbol: '' },
    });
    setNewLocale('');
  }

  return (
    <fieldset className="unit-translation-fields">
      <legend>{properties.text.admin.unitTranslations}</legend>
      {locales.map((language: string): JSX.Element => {
        const value: UnitTranslation =
          language === 'en'
            ? { name: properties.name, symbol: properties.symbol }
            : properties.translations[language];
        return (
          <fieldset key={language} className="unit-translation-fields__row">
            <legend>
              {languageNames.of(language) ?? language} ({language})
              {language === 'en' ? ` · ${properties.text.admin.unitDefaultLanguage}` : ''}
            </legend>
            <label>
              {properties.text.admin.unitName}
              <input
                required
                maxLength={100}
                value={value.name}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  update(language, 'name', event.currentTarget.value)
                }
              />
            </label>
            <label>
              {properties.text.admin.unitSymbol}
              <input
                required
                maxLength={100}
                value={value.symbol}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  update(language, 'symbol', event.currentTarget.value)
                }
              />
            </label>
            {language === 'en' ? null : (
              <button
                type="button"
                className="button--secondary"
                onClick={(): void => remove(language)}
              >
                {properties.text.admin.unitRemoveLanguage}
              </button>
            )}
          </fieldset>
        );
      })}
      <div className="unit-translation-fields__add">
        <label>
          {properties.text.admin.unitLanguage}
          <input
            value={newLocale}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              setNewLocale(event.currentTarget.value)
            }
          />
        </label>
        <button type="button" className="button--secondary" disabled={!canAdd} onClick={add}>
          {properties.text.admin.unitAddLanguage}
        </button>
      </div>
      <p className="hint">{properties.text.admin.unitLanguageHint}</p>
    </fieldset>
  );
}
