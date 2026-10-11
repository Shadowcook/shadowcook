import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { currentAuthenticatedPrincipal } from '../auth/principal.js';
import { mcpTools } from './tool-schemas.js';

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

const protocolVersion: string = '2025-06-18';

export function registerMcpRoutes(api: FastifyInstance, pool: Pool, publicApiOrigin: string): void {
  api.post('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('MCP-Protocol-Version', protocolVersion);
    const principal = await currentAuthenticatedPrincipal(pool, request);
    if (
      principal === null ||
      principal.disabled_at !== null ||
      principal.authentication_type === 'SESSION'
    ) {
      reply.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${publicApiOrigin}/.well-known/oauth-protected-resource", scope="shadowcook:recipes"`,
      );
      return reply.code(401).send({ error: 'OAuth authentication is required.' });
    }
    const body: JsonRpcRequest = request.body as JsonRpcRequest;
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string')
      return reply.code(400).send(jsonRpcError(null, -32600, 'Invalid JSON-RPC request.'));
    if (body.method === 'notifications/initialized') return reply.code(202).send();
    if (body.method === 'initialize')
      return reply.send(
        jsonRpcResult(body.id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'shadowcook', version: '2.0' },
        }),
      );
    if (body.method === 'ping') return reply.send(jsonRpcResult(body.id, {}));
    if (body.method === 'tools/list')
      return reply.send(jsonRpcResult(body.id, { tools: mcpTools }));
    if (body.method === 'tools/call') return handleToolCall(api, request, reply, body);
    return reply.send(jsonRpcError(body.id, -32601, 'Method not found.'));
  });
}

async function handleToolCall(
  api: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  body: JsonRpcRequest,
): Promise<FastifyReply> {
  const parameters: ToolCallParams = body.params as ToolCallParams;
  if (typeof parameters.name !== 'string' || !isPlainObject(parameters.arguments))
    return reply.send(jsonRpcError(body.id, -32602, 'Invalid tool arguments.'));
  const response: { statusCode: number; payload: string } | null = await invokeTool(
    api,
    request.headers.authorization!,
    parameters.name,
    parameters.arguments,
  );
  if (response === null) return reply.send(jsonRpcError(body.id, -32602, 'Unknown tool.'));
  const content: { type: 'text'; text: string }[] = [{ type: 'text', text: response.payload }];
  return reply.send(jsonRpcResult(body.id, { content, isError: response.statusCode >= 400 }));
}

async function invokeTool(
  api: FastifyInstance,
  authorization: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ statusCode: number; payload: string } | null> {
  const tenantSlug: string | null = stringArgument(args, 'tenantSlug');
  if (tenantSlug === null)
    return { statusCode: 400, payload: '{"error":"tenantSlug is required."}' };
  const headers: { authorization: string } = { authorization };
  if (name === 'search_recipes')
    return api.inject({
      method: 'GET',
      url: `/cookbook?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      headers,
    });
  if (name === 'list_recipe_drafts')
    return api.inject({
      method: 'GET',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/drafts`,
      headers,
    });
  if (name === 'search_ingredients') {
    const query: string | null = stringArgument(args, 'query');
    if (query === null) return { statusCode: 400, payload: '{"error":"query is required."}' };
    return api.inject({
      method: 'GET',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/editor-catalogue/ingredients?search=${encodeURIComponent(query)}`,
      headers,
    });
  }
  if (name === 'create_ingredient') {
    const ingredient = args.ingredient;
    if (!isPlainObject(ingredient))
      return { statusCode: 400, payload: '{"error":"ingredient is required."}' };
    return api.inject({
      method: 'POST',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/ingredients`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(ingredient),
    });
  }
  if (name === 'list_units')
    return api.inject({
      method: 'GET',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/editor-catalogue`,
      headers,
    });
  if (name === 'create_unit') {
    const unit = args.unit;
    if (!isPlainObject(unit)) return { statusCode: 400, payload: '{"error":"unit is required."}' };
    return api.inject({
      method: 'POST',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/units`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(unit),
    });
  }
  const publicId: string | null = stringArgument(args, 'publicId');
  if (name === 'create_recipe_draft') {
    const input = args.recipe;
    if (!isPlainObject(input))
      return { statusCode: 400, payload: '{"error":"recipe is required."}' };
    return api.inject({
      method: 'POST',
      url: `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(recipeInput(input)),
    });
  }
  if (publicId === null) return { statusCode: 400, payload: '{"error":"publicId is required."}' };
  const basePath: string = `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes/${encodeURIComponent(publicId)}/draft`;
  if (name === 'get_recipe_draft') return api.inject({ method: 'GET', url: basePath, headers });
  if (name === 'update_recipe_draft') {
    const input = args.recipe;
    if (!isPlainObject(input))
      return { statusCode: 400, payload: '{"error":"recipe is required."}' };
    return api.inject({
      method: 'PATCH',
      url: basePath,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(recipeInput(input)),
    });
  }
  if (name === 'get_recipe_steps')
    return api.inject({ method: 'GET', url: `${basePath}/steps`, headers });
  if (name === 'replace_recipe_steps') {
    if (!Array.isArray(args.steps))
      return { statusCode: 400, payload: '{"error":"steps is required."}' };
    return api.inject({
      method: 'PUT',
      url: `${basePath}/steps`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ steps: args.steps }),
    });
  }
  return null;
}

function recipeInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    title: input.title,
    summary: input.summary ?? null,
    slug: input.slug,
    categoryPublicIds: input.categoryPublicIds ?? [],
    visibilityOverride: input.visibilityOverride ?? null,
    discoverabilityOverride: input.discoverabilityOverride ?? null,
    isFeatured: input.isFeatured ?? true,
  };
}

function stringArgument(args: Record<string, unknown>, name: string): string | null {
  const value: unknown = args[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonRpcResult(id: unknown, result: object): object {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: unknown, code: number, message: string): object {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
