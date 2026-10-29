import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { createScanner, SyntaxKind, visit, type JSONScanner } from 'jsonc-parser';
import { createSchemaValidator } from './schema-validator.js';
import { portableRecipeIssues } from './semantics.js';
import type { ImportIssue, PortableRecipeDocument } from './types.js';

export const maximumImportBytes: number = 1_048_576;
const ajv: Ajv = createSchemaValidator();
const schema: object = JSON.parse(
  readFileSync(
    new URL('../../skills/v1/shadowcook-recipe/recipe.schema.json', import.meta.url),
    'utf8',
  ),
) as object;
const validate: ValidateFunction<PortableRecipeDocument> =
  ajv.compile<PortableRecipeDocument>(schema);

export type RecipeValidation =
  { document: PortableRecipeDocument; issues: [] } | { document: null; issues: ImportIssue[] };

export function validatePortableRecipe(json: unknown): RecipeValidation {
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > maximumImportBytes)
    return { document: null, issues: [{ path: '/', code: 'LIMIT' }] };
  const scanner: JSONScanner = createScanner(json);
  let depth: number = 0;
  let token: SyntaxKind = scanner.scan();
  while (token !== SyntaxKind.EOF) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth += 1;
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth -= 1;
    if (depth > 64) return { document: null, issues: [{ path: '/', code: 'LIMIT' }] };
    token = scanner.scan();
  }
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch (_error: unknown) {
    return { document: null, issues: [{ path: '/', code: 'JSON' }] };
  }
  const objects: Set<string>[] = [];
  let duplicate: boolean = false;
  visit(json, {
    onObjectBegin: (): void => {
      objects.push(new Set());
    },
    onObjectProperty: (name: string): void => {
      const names: Set<string> = objects[objects.length - 1]!;
      if (names.has(name)) duplicate = true;
      names.add(name);
    },
    onObjectEnd: (): void => {
      objects.pop();
    },
  });
  if (duplicate) return { document: null, issues: [{ path: '/', code: 'DUPLICATE' }] };
  if (!validate(document)) {
    return {
      document: null,
      issues: (validate.errors ?? []).slice(0, 40).map((error: ErrorObject): ImportIssue => ({
        path: error.instancePath || '/',
        code: 'SCHEMA',
      })),
    };
  }
  const issues: ImportIssue[] = portableRecipeIssues(document);
  return issues.length > 0 ? { document: null, issues } : { document, issues: [] };
}
