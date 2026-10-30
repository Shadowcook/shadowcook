import type { Translation } from '../i18n';

interface ApiErrorResponse {
  code?: unknown;
}

export async function ingredientRequestError(
  response: Response,
  text: Translation,
): Promise<string> {
  const body: ApiErrorResponse | null = await response.json().catch((): null => null);
  const code: string | null = typeof body?.code === 'string' ? body.code : null;
  const messages: Readonly<Record<string, string>> = {
    INGREDIENT_CONFLICT: text.errors.ingredientAlreadyExists,
    ALIAS_CONFLICT: text.errors.ingredientAlreadyExists,
    INGREDIENT_IN_USE: text.errors.ingredientInUse,
    INGREDIENT_NOT_FOUND: text.errors.ingredientNotFound,
    TARGET_INGREDIENT_NOT_FOUND: text.errors.ingredientNotFound,
    ALIAS_NOT_FOUND: text.errors.aliasNotFound,
    INVALID_INGREDIENT: text.errors.invalidIngredient,
    INVALID_ALIAS: text.errors.invalidIngredient,
    INVALID_INGREDIENT_CONSOLIDATION: text.errors.invalidIngredient,
  };
  return code === null ? text.errors.requestFailed : (messages[code] ?? text.errors.requestFailed);
}
