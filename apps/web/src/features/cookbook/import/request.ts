import { ApiRequestError } from '../../../lib/api/client.ts';
import type { Translation } from '../../../i18n';
import { recipeRequestError } from '../model/recipe-request-error.ts';
import type { ImportIssue } from './types';

export class RecipeImportRequestError extends ApiRequestError {
  public readonly issues: ImportIssue[];

  public constructor(code: string, status: number, issues: ImportIssue[]) {
    super(code, status);
    this.issues = issues;
  }
}

export async function recipeImportRequest<T>(
  tenantSlug: string,
  suffix: string,
  body: object,
): Promise<T> {
  const response: Response = await fetch(
    `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipe-imports${suffix}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const value: unknown = await response.json().catch((): null => null);
  if (!response.ok) {
    const failure: { code?: unknown; issues?: unknown } | null = value as {
      code?: unknown;
      issues?: unknown;
    } | null;
    const issues: ImportIssue[] = Array.isArray(failure?.issues)
      ? failure.issues.filter(
          (issue: unknown): issue is ImportIssue =>
            typeof issue === 'object' &&
            issue !== null &&
            'path' in issue &&
            typeof issue.path === 'string' &&
            'code' in issue &&
            typeof issue.code === 'string',
        )
      : [];
    throw new RecipeImportRequestError(
      typeof failure?.code === 'string' ? failure.code : 'REQUEST_FAILED',
      response.status,
      issues,
    );
  }
  return value as T;
}

export function recipeImportError(error: unknown, text: Translation): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 413) return text.recipeImport.errors.large!;
    const message: string | undefined = text.recipeImport.errors[error.code];
    if (message !== undefined) return message;
  }
  return recipeRequestError(error, text);
}
