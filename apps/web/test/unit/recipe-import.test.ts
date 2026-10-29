import type {
  ImportDocument,
  ImportVariantDetails,
} from '../../src/features/cookbook/import/types.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
import {
  importMappings,
  initialImportChoices,
  suggestedImportCategories,
  equivalentImportUnit,
  importedRecipeSlug,
  filteredImportCandidates,
  recipeWithVariantDetails,
  changeImportVariantName,
  importVariantSlugStatus,
} from '../../src/features/cookbook/import/model.ts';
import { recipeImportError } from '../../src/features/cookbook/import/request.ts';
import { ApiRequestError } from '../../src/lib/api/client.ts';
import type { Category } from '../../src/features/cookbook/model/types.ts';
import { managementRoute } from '../../src/features/cookbook/model/management-routing.ts';

test('import choices require explicit resolution and new unit symbols', (): void => {
  const choices = initialImportChoices(
    [{ key: 'cup', candidates: [], suggestedPublicId: null }],
    [{ key: 'cup', name: 'Cup', symbol: 'cup' }],
  );
  assert.equal(importMappings(choices, true), null);
  assert.deepEqual(importMappings([{ ...choices[0]!, selected: 'CREATE' }], true), [
    { key: 'cup', action: 'CREATE', name: 'Cup', symbol: 'cup' },
  ]);
  assert.equal(importMappings([{ ...choices[0]!, selected: 'CREATE', symbol: ' ' }], true), null);
  assert.deepEqual(importMappings([{ ...choices[0]!, selected: 'target-id' }], true), [
    { key: 'cup', action: 'EXISTING', publicId: 'target-id' },
  ]);
  assert.equal(
    equivalentImportUnit(
      { dimension: 'VOLUME', baseFactor: '250', baseOffset: '0' },
      { dimension: 'VOLUME', baseFactor: '236.5882365', baseOffset: '0' },
    ),
    false,
  );
});

test('category suggestions resolve complete paths and imported titles produce URL slugs', (): void => {
  assert.equal(managementRoute('/cookbook/manage/recipes/import').editorPath, 'import');
  assert.equal(managementRoute('/cookbook/recipes/import').editorPath, null);
  const categories: Category[] = [
    {
      public_id: 'root',
      parent_public_id: null,
      name: 'Main courses',
      slug: 'main',
      sort_order: 0,
    },
    { public_id: 'soup', parent_public_id: 'root', name: 'Soups', slug: 'soups', sort_order: 0 },
  ];
  assert.deepEqual(suggestedImportCategories([['Main courses', 'Soups']], categories), ['soup']);
  assert.deepEqual(suggestedImportCategories([['Unknown', 'Soups']], categories), []);
  assert.equal(importedRecipeSlug('Grüße aus Österreich'), 'grusse-aus-osterreich');
});

test('import API errors are resolved through both UI locales', (): void => {
  for (const text of [en, de]) {
    assert.equal(
      recipeImportError(new ApiRequestError('IMPORT_UNIT_MISMATCH', 409), text),
      text.recipeImport.errors.IMPORT_UNIT_MISMATCH,
    );
    assert.equal(
      recipeImportError(new ApiRequestError('REQUEST_FAILED', 413), text),
      text.recipeImport.errors.large,
    );
    assert.equal(
      recipeImportError(new ApiRequestError('TENANT_PERMISSION_REQUIRED', 403), text),
      text.recipeEditor.permissionRequired,
    );
  }
});

test('original suggestions stay separate from filtered existing results and alias flags apply only to ingredients', (): void => {
  const suggested = {
    publicId: 'suggested',
    name: 'Salt',
    symbol: null,
    conversion: null,
    match: 'SIMILAR' as const,
  };
  const other = { ...suggested, publicId: 'other', name: 'Pepper' };
  assert.deepEqual(filteredImportCandidates([suggested], [other, suggested, other]), [other]);
  const choice = {
    key: 'salt',
    selected: 'existing-id',
    name: 'Salt',
    symbol: '',
    addAsAlias: true,
  };
  assert.deepEqual(importMappings([choice], false), [
    { key: 'salt', action: 'EXISTING', publicId: 'existing-id', addAsAlias: true },
  ]);
  assert.deepEqual(importMappings([choice], true), [
    { key: 'salt', action: 'EXISTING', publicId: 'existing-id' },
  ]);
});

test('variant names and slugs can be edited without changing memberships and blank names use the locale default', (): void => {
  const document: ImportDocument = {
    format: 'shadowcook-recipe',
    formatVersion: 1,
    ingredients: [],
    units: [],
    recipe: {
      title: 'Recipe',
      steps: [],
      variants: [
        {
          key: 'default',
          name: 'Original',
          slug: 'old-source-slug',
          isDefault: true,
          isVisible: true,
          includedStepKeys: ['step'],
        },
      ],
    },
  };
  const edited: ImportDocument = recipeWithVariantDetails(
    document,
    [{ key: 'default', name: '  My preparation  ', slug: 'my-preparation' }],
    'Default',
  );
  assert.equal(edited.recipe.variants[0]!.name, 'My preparation');
  assert.equal(edited.recipe.variants[0]!.slug, 'my-preparation');
  assert.deepEqual(edited.recipe.variants[0]!.includedStepKeys, ['step']);
  assert.equal(document.recipe.variants[0]!.name, 'Original');
  assert.equal(document.recipe.variants[0]!.slug, 'old-source-slug');
  const defaultDocument: ImportDocument = recipeWithVariantDetails(
    document,
    [changeImportVariantName(document.recipe.variants[0]!, ' ', 'Standard')],
    'Standard',
  );
  assert.equal(defaultDocument.recipe.variants[0]!.name, 'Standard');
  assert.equal(defaultDocument.recipe.variants[0]!.slug, 'default');
  assert.deepEqual(defaultDocument.recipe.variants[0]!.includedStepKeys, ['step']);
  assert.equal(defaultDocument.recipe.variants[0]!.isDefault, true);
  assert.equal(defaultDocument.recipe.variants[0]!.isVisible, true);
});

test('empty and locale default variant names reset an imported slug to the canonical default', (): void => {
  const original: ImportVariantDetails = { key: 'original', name: 'Original', slug: 'old-slug' };
  for (const text of [en, de]) {
    for (const name of [
      '',
      '   ',
      text.recipeEditor.variantDefault,
      ` ${text.recipeEditor.variantDefault.toUpperCase()} `,
    ]) {
      const updated: ImportVariantDetails = changeImportVariantName(
        original,
        name,
        text.recipeEditor.variantDefault,
      );
      assert.equal(updated.slug, 'default');
      assert.equal(updated.name, name);
      assert.equal(updated.key, original.key);
    }
  }
  assert.equal(changeImportVariantName(original, 'Custom variant', 'Default').slug, 'old-slug');
  assert.equal(original.slug, 'old-slug');
});

test('variant slugs must be valid and unique within the imported recipe', (): void => {
  const variant: ImportVariantDetails = { key: 'original', name: 'Original', slug: 'custom-slug' };
  assert.equal(importVariantSlugStatus(variant, [variant]), 'valid');
  for (const slug of ['', 'With Spaces', '-leading', 'trailing-', 'a'.repeat(161)]) {
    assert.equal(importVariantSlugStatus({ ...variant, slug }, [variant]), 'invalid');
  }
  assert.equal(importVariantSlugStatus({ ...variant, slug: 'a'.repeat(160) }, [variant]), 'valid');
  assert.equal(
    importVariantSlugStatus(variant, [variant, { ...variant, key: 'other' }]),
    'conflict',
  );
  assert.equal(
    importVariantSlugStatus(variant, [variant, { ...variant, key: 'other', slug: 'another-slug' }]),
    'valid',
  );
});
