import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { mcpTools, type JsonSchema, type McpToolDefinition } from '../../src/mcp/tool-schemas.js';

const validUuid: string = '71fd5232-d844-445c-9bd2-563155fa0e74';

test('every MCP input schema uses portable types and retains closed objects and OAuth scope', (): void => {
  assert.deepEqual(
    mcpTools.map((definition: McpToolDefinition): string => definition.name),
    [
      'search_recipes',
      'list_recipe_drafts',
      'search_ingredients',
      'create_ingredient',
      'list_units',
      'create_unit',
      'get_recipe_draft',
      'create_recipe_draft',
      'update_recipe_draft',
      'get_recipe_steps',
      'replace_recipe_steps',
    ],
  );
  for (const definition of mcpTools) {
    assert.deepEqual(definition.securitySchemes, [
      { type: 'oauth2', scopes: ['shadowcook:recipes'] },
    ]);
    assert.deepEqual(
      definition.inputSchema.required,
      definition.name === 'search_recipes'
        ? ['tenantSlug']
        : Object.keys(definition.inputSchema.properties!),
    );
    inspectSchema(definition.inputSchema);
  }

  for (const name of ['create_recipe_draft', 'update_recipe_draft']) {
    const recipe: JsonSchema = toolSchema(name).properties!.recipe!;
    assert.deepEqual(recipe.required, ['title', 'slug']);
    assert.deepEqual(recipe.properties!.summary, {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  }
  const unit: JsonSchema = toolSchema('create_unit').properties!.unit!;
  const search: JsonSchema = toolSchema('search_recipes');
  assert.deepEqual(search.properties!.diet!.enum, ['VEGAN', 'VEGETARIAN', 'OMNI']);
  assert.equal(search.properties!.query!.type, 'string');
  assert.deepEqual(unit.required, ['name', 'symbol']);
  assert.deepEqual(unit.properties!.equivalenceAmount, {
    anyOf: [{ type: 'string' }, { type: 'null' }],
  });
  assert.deepEqual(unit.properties!.referenceUnitPublicId, {
    anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
  });
});

test('all published MCP tool input schemas compile as valid JSON Schema', async (): Promise<void> => {
  const api: FastifyInstance = Fastify();
  for (const definition of mcpTools) {
    api.post(
      `/validate/${definition.name}`,
      { schema: { body: definition.inputSchema } },
      async (): Promise<object> => ({}),
    );
  }
  try {
    await api.ready();
  } finally {
    await api.close();
  }
});

interface SchemaCase {
  name: string;
  payload: Record<string, unknown>;
  valid: boolean;
}

const unitCases: SchemaCase[] = [
  { name: 'omitted optional conversion', payload: { name: 'Cup', symbol: 'cup' }, valid: true },
  {
    name: 'explicit null conversion',
    payload: { name: 'Cup', symbol: 'cup', equivalenceAmount: null, referenceUnitPublicId: null },
    valid: true,
  },
  {
    name: 'string conversion with UUID',
    payload: {
      name: 'Cup',
      symbol: 'cup',
      equivalenceAmount: '250',
      referenceUnitPublicId: validUuid,
    },
    valid: true,
  },
  {
    name: 'empty nullable string',
    payload: { name: 'Cup', symbol: 'cup', equivalenceAmount: '' },
    valid: true,
  },
  {
    name: 'invalid UUID',
    payload: { name: 'Cup', symbol: 'cup', referenceUnitPublicId: 'not-a-uuid' },
    valid: false,
  },
  {
    name: 'empty UUID',
    payload: { name: 'Cup', symbol: 'cup', referenceUnitPublicId: '' },
    valid: false,
  },
  {
    name: 'numeric amount',
    payload: { name: 'Cup', symbol: 'cup', equivalenceAmount: 250 },
    valid: false,
  },
  { name: 'missing required name', payload: { symbol: 'cup' }, valid: false },
  { name: 'empty required string', payload: { name: '', symbol: 'cup' }, valid: false },
  {
    name: 'additional property',
    payload: { name: 'Cup', symbol: 'cup', extra: true },
    valid: false,
  },
];
const recipeCases: SchemaCase[] = [
  {
    name: 'optional metadata with only calories',
    payload: { title: 'Soup', slug: 'soup', metadata: { kcal: 200 } },
    valid: true,
  },
  {
    name: 'optional metadata with only servings',
    payload: { title: 'Soup', slug: 'soup', metadata: { servings: 2 } },
    valid: true,
  },
  {
    name: 'explicit vegan diet',
    payload: { title: 'Soup', slug: 'soup', diet: 'VEGAN' },
    valid: true,
  },
  {
    name: 'clear dietary classification',
    payload: { title: 'Soup', slug: 'soup', diet: null },
    valid: true,
  },
  {
    name: 'invalid dietary classification',
    payload: { title: 'Soup', slug: 'soup', diet: 'INVALID' },
    valid: false,
  },
  {
    name: 'zero servings',
    payload: { title: 'Soup', slug: 'soup', metadata: { servings: 0 } },
    valid: false,
  },
  {
    name: 'derived calories cannot be written',
    payload: { title: 'Soup', slug: 'soup', metadata: { kcalPerServing: 50 } },
    valid: false,
  },
  { name: 'omitted optional summary', payload: { title: 'Soup', slug: 'soup' }, valid: true },
  {
    name: 'explicit null summary',
    payload: { title: 'Soup', slug: 'soup', summary: null },
    valid: true,
  },
  {
    name: 'string summary',
    payload: { title: 'Soup', slug: 'soup', summary: 'Warm soup' },
    valid: true,
  },
  { name: 'empty summary', payload: { title: 'Soup', slug: 'soup', summary: '' }, valid: true },
  { name: 'numeric summary', payload: { title: 'Soup', slug: 'soup', summary: 123 }, valid: false },
  { name: 'missing required title', payload: { slug: 'soup' }, valid: false },
  {
    name: 'additional property',
    payload: { title: 'Soup', slug: 'soup', extra: true },
    valid: false,
  },
];

for (const name of ['create_unit', 'create_recipe_draft', 'update_recipe_draft']) {
  test(`${name} preserves nullable validation, optionality, formats, and required fields`, async (): Promise<void> => {
    const api: FastifyInstance = Fastify({
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
    });
    const schema: JsonSchema = toolSchema(name);
    api.post('/validate', { schema: { body: schema } }, async (): Promise<object> => ({}));
    try {
      const property: string = name === 'create_unit' ? 'unit' : 'recipe';
      const cases: SchemaCase[] = name === 'create_unit' ? unitCases : recipeCases;
      for (const example of cases) {
        const payload: Record<string, unknown> = {
          tenantSlug: 'schema-test',
          ...(name === 'update_recipe_draft' ? { publicId: validUuid } : {}),
          [property]: example.payload,
        };
        const response: LightMyRequestResponse = await api.inject({
          method: 'POST',
          url: '/validate',
          payload,
        });
        assert.equal(response.statusCode, example.valid ? 200 : 400, example.name);
      }
      const invalidInputs: Record<string, unknown>[] = [
        {},
        { tenantSlug: 'schema-test' },
        {
          tenantSlug: 'schema-test',
          ...(name === 'update_recipe_draft' ? { publicId: validUuid } : {}),
          [property]: cases[0]!.payload,
          extra: true,
        },
      ];
      for (const payload of invalidInputs) {
        const response: LightMyRequestResponse = await api.inject({
          method: 'POST',
          url: '/validate',
          payload,
        });
        assert.equal(response.statusCode, 400);
      }
    } finally {
      await api.close();
    }
  });
}

function toolSchema(name: string): JsonSchema {
  const definition: McpToolDefinition | undefined = mcpTools.find(
    (candidate: McpToolDefinition): boolean => candidate.name === name,
  );
  assert.ok(definition, name);
  return definition.inputSchema;
}

function inspectSchema(schema: JsonSchema): void {
  assert.equal(Array.isArray(schema.type), false);
  if (schema.type === 'object') assert.equal(schema.additionalProperties, false);
  for (const child of Object.values(schema.properties ?? {})) inspectSchema(child);
  for (const branch of schema.anyOf ?? []) inspectSchema(branch);
  if (schema.items !== undefined) inspectSchema(schema.items);
}
