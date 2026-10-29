import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validatePortableRecipe } from '../../src/recipe-import/validation.js';
import {
  equivalentConversion,
  ingredientSuggestions,
  suggestedMatch,
  unitSuggestions,
  type IngredientCandidate,
} from '../../src/recipe-import/matching.js';
import type { MatchCandidate, PortableRecipeDocument } from '../../src/recipe-import/types.js';
import { parseImportInput } from '../../src/recipe-import/requests.js';

function example(): PortableRecipeDocument {
  return JSON.parse(
    readFileSync(
      new URL('../../skills/v1/shadowcook-recipe/examples/variants.json', import.meta.url),
      'utf8',
    ),
  ) as PortableRecipeDocument;
}

test('portable recipe validation checks structure, identity references and strict JSON parsing', (): void => {
  assert.ok(validatePortableRecipe(JSON.stringify(example())).document);
  for (const json of [
    '{"format":"shadowcook-recipe","format":"other"}',
    '{"ingredients":[{"key":"a","key":"b"}]}',
    '{broken',
    '{"a":NaN}',
    JSON.stringify({ ...example(), formatVersion: '1' }),
    JSON.stringify({
      ...example(),
      units: [
        {
          key: 'g',
          name: 'Gram',
          symbol: 'g',
          conversion: { dimension: 'MASS', baseFactor: '1', baseOffset: '2' },
        },
      ],
    }),
  ])
    assert.equal(validatePortableRecipe(json).document, null, json);
  for (const mutate of [
    (document: PortableRecipeDocument): void => {
      document.recipe.variants[1]!.isDefault = true;
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.variants[0]!.includedStepKeys = ['missing'];
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.steps[0]!.entries[0]!.ingredientKey = 'missing';
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.steps[0]!.entries[0]!.alias = 'unknown';
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.steps[0]!.entries[0]!.unitKey = 'missing';
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.metadata!.activeMinutes = 31;
    },
    (document: PortableRecipeDocument): void => {
      document.recipe.steps[0]!.instruction = 'See {recipe:unknown}.';
    },
    (document: PortableRecipeDocument): void => {
      document.recipeReferences = [
        { key: 'sauce', title: 'Sauce', url: 'https://example.test/sauce?access_token=secret' },
      ];
    },
  ]) {
    const document: PortableRecipeDocument = example();
    mutate(document);
    assert.equal(validatePortableRecipe(JSON.stringify(document)).document, null);
  }
  assert.equal(validatePortableRecipe('['.repeat(65) + ']'.repeat(65)).issues[0]?.code, 'LIMIT');
  assert.equal(validatePortableRecipe(' '.repeat(1_048_577)).issues[0]?.code, 'LIMIT');
});

test('matching distinguishes exact names, aliases, ambiguity and incompatible unit definitions', (): void => {
  const salt: IngredientCandidate = {
    publicId: 'salt',
    name: 'Salt',
    symbol: null,
    conversion: null,
    match: 'SIMILAR',
    aliases: [{ publicId: 'salz', name: 'Salz' }],
  };
  const matches: MatchCandidate[] = ingredientSuggestions({ key: 'salt', name: ' Salz ' }, [salt]);
  assert.equal(matches[0]!.match, 'ALIAS');
  assert.equal(suggestedMatch(matches), 'salt');
  assert.equal(suggestedMatch([...matches, { ...salt, publicId: 'second', match: 'EXACT' }]), null);
  const gram: MatchCandidate = {
    publicId: 'gram',
    name: 'Gram',
    symbol: 'g',
    conversion: { dimension: 'MASS', baseFactor: '1.000000000000', baseOffset: '0.000000000000' },
    match: 'SIMILAR',
  };
  assert.equal(
    equivalentConversion({ dimension: 'MASS', baseFactor: '1', baseOffset: '0' }, gram.conversion),
    true,
  );
  assert.equal(
    unitSuggestions(
      {
        key: 'cup',
        name: 'Cup',
        symbol: 'cup',
        conversion: { dimension: 'VOLUME', baseFactor: '250', baseOffset: '0' },
      },
      [{ ...gram, name: 'Cup', symbol: 'cup' }],
    ).length,
    0,
  );
  const source = {
    key: 'g',
    name: 'Gramm',
    symbol: 'g',
    conversion: { dimension: 'MASS' as const, baseFactor: '1', baseOffset: '0' },
  };
  assert.equal(suggestedMatch(unitSuggestions(source, [gram]), true), 'gram');
});

test('import requests cannot smuggle catalogue writes into existing selections', (): void => {
  const input: object = {
    json: '{}',
    slug: 'recipe',
    categoryPublicIds: [],
    ingredients: [
      {
        key: 'salt',
        action: 'EXISTING',
        publicId: '2135e3cb-47f7-4a84-9d12-54e62db06229',
        name: 'Injected rename',
      },
    ],
    units: [],
  };
  assert.equal(parseImportInput(input), null);
  assert.equal(
    parseImportInput({
      json: '{}',
      slug: 'admin',
      categoryPublicIds: [],
      ingredients: [],
      units: [],
    }),
    null,
  );
});
