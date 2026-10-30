import assert from 'node:assert/strict';
import test from 'node:test';
import { de } from '../../src/i18n/de.ts';
import { en } from '../../src/i18n/en.ts';
import type { Translation } from '../../src/i18n/types.ts';
import { ApiRequestError } from '../../src/lib/api/client.ts';
import { recipeRequestError } from '../../src/features/cookbook/model/recipe-request-error.ts';

test('recipe write errors resolve specific localized messages', (): void => {
  const locales: Translation[] = [en, de];
  for (const text of locales) {
    const cases: Readonly<Record<string, string>> = {
      RECIPE_CONFLICT: text.recipeEditor.slugConflict,
      INVALID_RECIPE: text.recipeEditor.invalidRecipe,
      INVALID_RECIPE_CATEGORY: text.recipeEditor.invalidCategory,
      INVALID_RECIPE_STEPS: text.recipeEditor.invalidSteps,
      RECIPE_VARIANT_CONFLICT: text.recipeEditor.variantSlugConflict,
      INVALID_RECIPE_VARIANT: text.recipeEditor.invalidVariant,
      RECIPE_NOT_FOUND: text.recipeEditor.recipeNotFound,
      AUTHENTICATION_REQUIRED: text.recipeEditor.authenticationRequired,
      TENANT_PERMISSION_REQUIRED: text.recipeEditor.permissionRequired,
      PUBLISH_CATEGORY_REQUIRED: text.recipeEditor.publishNeedsCategory,
    };
    for (const [code, expected] of Object.entries(cases)) {
      assert.equal(recipeRequestError(new ApiRequestError(code), text), expected);
      assert.notEqual(expected, text.errors.requestFailed);
    }
  }
});

test('transport and server failures are named without exposing internal messages', (): void => {
  const text: Translation = en;
  assert.equal(
    recipeRequestError(new TypeError('Internal fetch details'), text),
    text.recipeEditor.connectionFailed,
  );
  assert.equal(
    recipeRequestError(new ApiRequestError('REQUEST_FAILED', 500), text),
    text.recipeEditor.serverError,
  );
  assert.equal(
    recipeRequestError(new ApiRequestError('REQUEST_FAILED', 401), text),
    text.recipeEditor.authenticationRequired,
  );
  assert.equal(
    recipeRequestError(new ApiRequestError('REQUEST_FAILED', 403), text),
    text.recipeEditor.permissionRequired,
  );
  assert.equal(
    recipeRequestError(new ApiRequestError('NEW_BUSINESS_ERROR', 409), text),
    text.recipeEditor.unknownApiError.replace('{code}', 'NEW_BUSINESS_ERROR'),
  );
  assert.equal(
    recipeRequestError(new ApiRequestError('SQL: confidential details'), text),
    text.errors.requestFailed,
  );
});
