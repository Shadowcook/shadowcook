import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from '../../src/i18n/en.ts';
import { recipeJsonLd } from '../../src/features/cookbook/server/recipe-structured-data.ts';
import {
  recipeSpecialEntries,
  type RecipeSpecialEntry,
} from '../../src/features/cookbook/model/special-entries.ts';
import type { IngredientUsage, RecipeDetail } from '../../src/features/cookbook/model/types.ts';
import { pdfRecipeFixture } from '../fixtures/pdf-recipe.ts';

test('JSON-LD retains every special kind note on its own step without inventing durations', (): void => {
  recipeSpecialEntries(en).forEach((special: RecipeSpecialEntry): void => {
    const recipe: RecipeDetail = pdfRecipeFixture();
    const entry: IngredientUsage = {
      ...recipe.steps[1]!.ingredients[1]!,
      special_kind: special.kind,
      note: '30-40 Minuten',
    };
    recipe.steps[0]!.instruction = 'Stir.';
    recipe.steps[1]!.instruction = 'Sosse abgedeckt kochen lassen.';
    recipe.steps[1]!.ingredients = [entry, { ...entry }];
    const data: ReturnType<typeof recipeJsonLd> = recipeJsonLd(
      recipe,
      [],
      [],
      'Test',
      'https://example.test/recipe',
      en,
    );
    assert.equal(data.recipeInstructions[0]!.text, 'Stir.');
    assert.equal(
      data.recipeInstructions[1]!.text,
      'Sosse abgedeckt kochen lassen. (30-40 Minuten)',
    );
    assert.equal(data['@type'], 'Recipe');
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
    assert.equal('totalTime' in data, false);
    assert.equal(
      data.recipeIngredient.some((value: string): boolean => value.includes('30-40')),
      false,
    );
  });
});

test('empty notes and notes already in the instruction add no artificial information', (): void => {
  const recipe: RecipeDetail = pdfRecipeFixture();
  recipe.steps[1]!.instruction = 'Wait 30-40 Minuten.';
  const entry: IngredientUsage = recipe.steps[1]!.ingredients[1]!;
  recipe.steps[1]!.ingredients = [
    { ...entry, note: null },
    { ...entry, note: '  ' },
    { ...entry, note: '30-40 Minuten' },
  ];
  const data: ReturnType<typeof recipeJsonLd> = recipeJsonLd(
    recipe,
    [],
    [],
    'Test',
    'https://example.test/recipe',
    en,
  );
  assert.equal(data.recipeInstructions[1]!.text, recipe.steps[1]!.instruction);
});
