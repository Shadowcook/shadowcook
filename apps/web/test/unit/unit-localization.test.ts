import assert from 'node:assert/strict';
import test from 'node:test';
import { de } from '../../src/i18n/de.ts';
import { en } from '../../src/i18n/en.ts';
import {
  localizedUnitName,
  localizedUnitSymbol,
  type UnitTranslations,
} from '../../src/i18n/unit-localization.ts';

test('units display database versions for the active UI language and reflect edits', (): void => {
  const versions: UnitTranslations = {
    de: { name: 'Teelöffel', symbol: 'TL' },
    fr: { name: 'cuillère à café', symbol: 'c. à café' },
  };
  assert.equal(localizedUnitName(de, versions, 'teaspoon'), 'Teelöffel');
  assert.equal(localizedUnitSymbol(de, versions, 'tsp'), 'TL');
  assert.equal(localizedUnitName(en, versions, 'teaspoon'), 'teaspoon');
  assert.equal(localizedUnitSymbol(en, versions, 'tsp'), 'tsp');
  versions.de = { name: 'Messlöffel', symbol: 'ML' };
  assert.equal(localizedUnitName(de, versions, 'teaspoon'), 'Messlöffel');
  assert.equal(localizedUnitSymbol(de, versions, 'tsp'), 'ML');
  delete versions.de;
  assert.equal(localizedUnitName(de, versions, 'teaspoon'), 'teaspoon');
  assert.equal(localizedUnitSymbol(de, versions, 'tsp'), 'tsp');
});
