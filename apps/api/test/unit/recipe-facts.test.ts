import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecipeFactsInput, recipeDietFilterValues } from '../../src/cookbook/recipe-facts.js';

test('recipe facts accept missing values independently and retain explicit zero calories', (): void => {
  assert.deepEqual(parseRecipeFactsInput({}), {});
  assert.deepEqual(parseRecipeFactsInput({ metadata: { kcal: 0 } }), {
    metadata: {
      difficulty: null,
      totalMinutes: null,
      activeMinutes: null,
      kcal: 0,
      servings: null,
      utensils: null,
    },
  });
  assert.ok(parseRecipeFactsInput({ metadata: { servings: 2.5 } }));
  assert.ok(parseRecipeFactsInput({ metadata: { activeMinutes: 30 } }));
  assert.equal(parseRecipeFactsInput({ metadata: { utensils: '   ' } })?.metadata?.utensils, null);
  assert.equal(
    parseRecipeFactsInput({ metadata: { utensils: ' Whisk\n  Mixing bowl ' } })?.metadata?.utensils,
    ' Whisk\n  Mixing bowl ',
  );
});

test('recipe facts reject invalid values and writes to computed or automatic fields', (): void => {
  const invalid: Record<string, unknown>[] = [
    { metadata: null },
    { metadata: [] },
    { metadata: { difficulty: 'HARD' } },
    { diet: 'fish' },
    { metadata: { kcal: -1 } },
    { metadata: { kcal: Infinity } },
    { metadata: { kcal: '250' } },
    { metadata: { servings: 0 } },
    { metadata: { servings: -2 } },
    { metadata: { totalMinutes: 2.5 } },
    { metadata: { activeMinutes: -1 } },
    { metadata: { totalMinutes: 30, activeMinutes: 31 } },
    { metadata: { utensils: 'x'.repeat(4001) } },
    { metadata: { kcalPerServing: 20 } },
    { createdAt: '2026-10-20T00:00:00Z' },
    { updatedAt: null },
    { kcalPerServing: 20 },
  ];
  for (const input of invalid)
    assert.equal(parseRecipeFactsInput(input), null, JSON.stringify(input));
});

test('diet filters include only classifications at least as restrictive as the selected diet', (): void => {
  assert.deepEqual(recipeDietFilterValues('VEGAN'), ['VEGAN']);
  assert.deepEqual(recipeDietFilterValues('VEGETARIAN'), ['VEGAN', 'VEGETARIAN']);
  assert.deepEqual(recipeDietFilterValues('OMNI'), ['VEGAN', 'VEGETARIAN', 'OMNI']);
});
