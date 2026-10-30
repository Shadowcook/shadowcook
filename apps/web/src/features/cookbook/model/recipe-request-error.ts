import type { Translation } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api/client.ts';

export function recipeRequestError(error: unknown, text: Translation): string {
  if (!(error instanceof ApiRequestError)) return text.recipeEditor.connectionFailed;

  const messages: Readonly<Record<string, string>> = {
    INVALID_RECIPE_IMAGE: text.recipeImage.invalidImage,
    FST_ERR_CTP_BODY_TOO_LARGE: text.recipeImage.invalidImage,
    RECIPE_CONFLICT: text.recipeEditor.slugConflict,
    INVALID_RECIPE: text.recipeEditor.invalidRecipe,
    INVALID_RECIPE_CATEGORY: text.recipeEditor.invalidCategory,
    INVALID_RECIPE_STEPS: text.recipeEditor.invalidSteps,
    INVALID_RECIPE_VARIANT: text.recipeEditor.invalidVariant,
    INVALID_RECIPE_SLUG_QUERY: text.recipeEditor.invalidSlug,
    RECIPE_NOT_FOUND: text.recipeEditor.recipeNotFound,
    RECIPE_DRAFT_NOT_FOUND: text.recipeEditor.draftNotFound,
    RECIPE_VARIANT_CONFLICT: text.recipeEditor.variantSlugConflict,
    RECIPE_VARIANT_HAS_STEPS: text.recipeEditor.variantHasSteps,
    PUBLISH_CATEGORY_REQUIRED: text.recipeEditor.publishNeedsCategory,
    AUTHENTICATION_REQUIRED: text.recipeEditor.authenticationRequired,
    TENANT_PERMISSION_REQUIRED: text.recipeEditor.permissionRequired,
    TENANT_NOT_FOUND: text.recipeEditor.tenantNotFound,
  };
  if (Object.hasOwn(messages, error.code)) return messages[error.code]!;
  if (error.status === 401) return text.recipeEditor.authenticationRequired;
  if (error.status === 403) return text.recipeEditor.permissionRequired;
  if (error.status !== undefined && error.status >= 500) return text.recipeEditor.serverError;
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) && error.code !== 'REQUEST_FAILED'
    ? text.recipeEditor.unknownApiError.replace('{code}', error.code)
    : text.errors.requestFailed;
}
