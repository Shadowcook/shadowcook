import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUnitTranslations } from '../../src/unit-translations.js';

test('unit translation parsing distinguishes omitted, empty, and populated versions', (): void => {
  assert.equal(parseUnitTranslations(undefined), undefined);
  assert.deepEqual(parseUnitTranslations({}), {});
  assert.deepEqual(
    parseUnitTranslations({
      de: { name: ' Teelöffel ', symbol: ' TL ' },
      'fr-ca': { name: 'cuillère à café', symbol: 'c. à café' },
    }),
    {
      de: { name: 'Teelöffel', symbol: 'TL' },
      'fr-ca': { name: 'cuillère à café', symbol: 'c. à café' },
    },
  );
});

test('unit translation parsing rejects invalid language versions', (): void => {
  const invalid: unknown[] = [
    null,
    [],
    'de',
    { en: { name: 'spoon', symbol: 'sp' } },
    { DE: { name: 'Löffel', symbol: 'L' } },
    { 'de-12': { name: 'Löffel', symbol: 'L' } },
    { de: { name: '', symbol: 'TL' } },
    { de: { name: 'Löffel', symbol: ' ' } },
    { de: { name: 'x'.repeat(101), symbol: 'TL' } },
    { de: { name: 'Löffel' } },
    { de: { name: 'Löffel', symbol: 'TL', extra: true } },
  ];
  for (const value of invalid) assert.equal(parseUnitTranslations(value), null);
});
