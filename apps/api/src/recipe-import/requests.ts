import { Ajv, type ValidateFunction } from 'ajv';
import { createSchemaValidator } from './schema-validator.js';
import type { ImportInput } from './types.js';

const ajv: Ajv = createSchemaValidator();
function mappingSchema(allowAliases: boolean): object {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'action', 'publicId'],
        properties: {
          key: { type: 'string' },
          action: { const: 'EXISTING' },
          publicId: { type: 'string', format: 'uuid' },
          ...(allowAliases ? { addAsAlias: { type: 'boolean' } } : {}),
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'action', 'name'],
        properties: {
          key: { type: 'string' },
          action: { const: 'CREATE' },
          name: { type: 'string', pattern: '\\S', maxLength: 240 },
          symbol: { type: 'string', pattern: '\\S', maxLength: 80 },
        },
      },
    ],
  };
}
const validateInput: ValidateFunction<ImportInput> = ajv.compile<ImportInput>({
  type: 'object',
  additionalProperties: false,
  required: ['json', 'slug', 'categoryPublicIds', 'ingredients', 'units'],
  properties: {
    json: { type: 'string' },
    slug: {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      maxLength: 160,
      not: {
        enum: [
          'admin',
          'api',
          'assets',
          'auth',
          'health',
          'login',
          'logout',
          'recipes',
          'settings',
        ],
      },
    },
    categoryPublicIds: {
      type: 'array',
      maxItems: 200,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    ingredients: { type: 'array', maxItems: 500, items: mappingSchema(true) },
    units: { type: 'array', maxItems: 200, items: mappingSchema(false) },
  },
});

export function parseImportInput(value: unknown): ImportInput | null {
  return validateInput(value) ? value : null;
}
