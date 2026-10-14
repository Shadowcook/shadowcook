import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recipeCreationCategoryId,
  recipeCreationPath,
} from '../../src/features/cookbook/model/recipe-creation.ts';
import type { Category } from '../../src/features/cookbook/model/types.ts';

const categoryId: string = '00000000-0000-4000-8000-000000000001';
const categories: Category[] = [
  {
    public_id: categoryId,
    parent_public_id: null,
    name: 'Breakfast',
    slug: 'breakfast',
    sort_order: 0,
  },
];

test('category creation links retain their selection after parsing the editor URL', (): void => {
  const url: URL = new URL(
    recipeCreationPath('my cookbook', categories, categoryId),
    'https://example.test',
  );
  assert.equal(url.pathname, '/my%20cookbook/recipes/new');
  assert.equal(
    recipeCreationCategoryId(categories, url.searchParams.get('categoryPublicId')),
    categoryId,
  );
});

test('Featured and non-category selections do not prefill recipe categories', (): void => {
  for (const selection of [null, 'featured', 'search', 'unknown-category']) {
    assert.equal(recipeCreationPath('cookbook', categories, selection), '/cookbook/recipes/new');
    assert.equal(recipeCreationCategoryId(categories, selection), null);
  }
  assert.equal(recipeCreationCategoryId([], categoryId), null);
});
