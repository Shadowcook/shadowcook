import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
import {
  emptyRecipeMetadata,
  recipeKcalPerServing,
  recipeMetadataRows,
  type RecipeContentMetadata,
  type RecipeMetadataRow,
} from '../../src/features/cookbook/model/recipe-metadata.ts';
import { createRecipePdfDefinition } from '../../src/features/cookbook/model/recipe-pdf.ts';
import { pdfRecipeFixture } from '../fixtures/pdf-recipe.ts';
import type { RecipeDetail } from '../../src/features/cookbook/model/types.ts';

test('missing calories or servings hide only the derived field in recipe and PDF output', (): void => {
  const cases: RecipeContentMetadata[] = [
    emptyRecipeMetadata(),
    { ...emptyRecipeMetadata(), kcal: 800 },
    { ...emptyRecipeMetadata(), servings: 4 },
  ];
  for (const metadata of cases) {
    assert.equal(recipeKcalPerServing(metadata), null);
    const rows: RecipeMetadataRow[] = recipeMetadataRows({ metadata }, en);
    assert.ok(
      !rows.some(
        (row: RecipeMetadataRow): boolean => row.label === en.recipeMetadata.kcalPerServing,
      ),
    );
    assert.equal(rows.length, metadata.kcal === null && metadata.servings === null ? 0 : 1);
    const recipe: RecipeDetail = { ...pdfRecipeFixture(), metadata };
    assert.ok(
      !JSON.stringify(createRecipePdfDefinition(recipe, en).content).includes(
        en.recipeMetadata.kcalPerServing,
      ),
    );
  }
});

test('metadata output calculates calories without trailing decimals and keeps zero values', (): void => {
  const metadata: RecipeContentMetadata = {
    ...emptyRecipeMetadata(),
    kcal: 1000,
    servings: 4,
    totalMinutes: 90,
    activeMinutes: 0,
    difficulty: 'EASY',
    utensils: 'Whisk\n  Bowl',
  };
  assert.equal(recipeKcalPerServing(metadata), 250);
  const rows: RecipeMetadataRow[] = recipeMetadataRows({ metadata, diet: 'VEGAN' }, de);
  assert.ok(rows.some((row: RecipeMetadataRow): boolean => row.value === '250'));
  assert.ok(rows.some((row: RecipeMetadataRow): boolean => row.value === '1 Std. 30 Min.'));
  assert.ok(rows.some((row: RecipeMetadataRow): boolean => row.value === '0 Min.'));
  assert.ok(rows.some((row: RecipeMetadataRow): boolean => row.value === 'Whisk\n  Bowl'));
  assert.ok(rows.some((row: RecipeMetadataRow): boolean => row.value === 'Einfach'));
  assert.equal(recipeKcalPerServing({ ...metadata, kcal: 0 }), 0);
  assert.equal(recipeKcalPerServing({ ...metadata, servings: 0 }), null);
});

test('PDF ends with the same localized metadata values as the recipe view', (): void => {
  const recipe: RecipeDetail = {
    ...pdfRecipeFixture(),
    metadata: { ...emptyRecipeMetadata(), kcal: 800, servings: 4, utensils: 'Springform Ø 26 cm' },
    diet: 'VEGETARIAN',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z',
  };
  const serialized: string = JSON.stringify(createRecipePdfDefinition(recipe, de).content);
  for (const row of recipeMetadataRows(recipe, de)) {
    assert.ok(serialized.includes(JSON.stringify(row.label)), row.label);
    assert.ok(serialized.includes(JSON.stringify(row.value)), row.value);
  }
  assert.ok(
    serialized.lastIndexOf(de.recipeMetadata.title) >
      serialized.lastIndexOf(de.dashboard.preparation),
  );
});
