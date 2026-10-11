export interface JsonSchema {
  type?: string;
  minLength?: number;
  format?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  securitySchemes: { type: 'oauth2'; scopes: string[] }[];
  inputSchema: JsonSchema;
}

const oauthScope: string = 'shadowcook:recipes';

const stringSchema: JsonSchema = { type: 'string', minLength: 1 };
const uuidSchema: JsonSchema = { type: 'string', format: 'uuid' };
const recipeSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'slug'],
  properties: {
    title: stringSchema,
    slug: stringSchema,
    summary: nullableSchema({ type: 'string' }),
    categoryPublicIds: { type: 'array', items: uuidSchema },
    isFeatured: { type: 'boolean' },
  },
};
const ingredientSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['canonicalName'],
  properties: {
    canonicalName: stringSchema,
    aliases: { type: 'array', items: stringSchema },
  },
};
const unitSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'symbol'],
  properties: {
    name: stringSchema,
    symbol: stringSchema,
    equivalenceAmount: nullableSchema({ type: 'string' }),
    referenceUnitPublicId: nullableSchema(uuidSchema),
  },
};

export const mcpTools: McpToolDefinition[] = [
  tool('search_recipes', 'Search published recipes in an accessible tenant.', {
    tenantSlug: stringSchema,
  }),
  tool('list_recipe_drafts', 'List the recipe drafts in a tenant.', { tenantSlug: stringSchema }),
  tool('search_ingredients', 'Search ingredients before creating a new tenant ingredient.', {
    tenantSlug: stringSchema,
    query: stringSchema,
  }),
  tool('create_ingredient', 'Create an ingredient that belongs only to this tenant.', {
    tenantSlug: stringSchema,
    ingredient: ingredientSchema,
  }),
  tool(
    'list_units',
    'List available instance and tenant units before creating a new tenant unit.',
    {
      tenantSlug: stringSchema,
    },
  ),
  tool(
    'create_unit',
    'Create a unit that belongs only to this tenant. Use it only when no suitable unit exists.',
    { tenantSlug: stringSchema, unit: unitSchema },
  ),
  tool('get_recipe_draft', 'Read a recipe draft or the published revision used to start a draft.', {
    tenantSlug: stringSchema,
    publicId: uuidSchema,
  }),
  tool(
    'create_recipe_draft',
    'Create a recipe as a draft. The recipe is never published by this tool.',
    { tenantSlug: stringSchema, recipe: recipeSchema },
  ),
  tool(
    'update_recipe_draft',
    'Update recipe metadata in a draft. Read the recipe first and preserve fields that should not change.',
    { tenantSlug: stringSchema, publicId: uuidSchema, recipe: recipeSchema },
  ),
  tool('get_recipe_steps', 'Read the preparation steps of an editable recipe.', {
    tenantSlug: stringSchema,
    publicId: uuidSchema,
  }),
  tool(
    'replace_recipe_steps',
    'Replace all preparation steps in a draft. This tool never publishes a recipe.',
    { tenantSlug: stringSchema, publicId: uuidSchema, steps: { type: 'array' } },
  ),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
): McpToolDefinition {
  return {
    name,
    description,
    securitySchemes: [{ type: 'oauth2', scopes: [oauthScope] }],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
  };
}

function nullableSchema(schema: JsonSchema): JsonSchema {
  return {
    anyOf: [schema, { type: 'null' }],
  };
}
