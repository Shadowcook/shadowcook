import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createTestUser, assignTenantRole, type TestUser } from '../helpers/actors.js';
import { createTestApi } from '../helpers/api.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface OAuthClientRegistration {
  client_id: string;
  token_endpoint_auth_method: 'none';
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: 'shadowcook:recipes';
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

test('OAuth discovery describes the restored MCP authorization server', async (): Promise<void> => {
  const protectedResourceResponse = await api.inject({
    method: 'GET',
    url: '/.well-known/oauth-protected-resource',
  });
  const authorizationServerResponse = await api.inject({
    method: 'GET',
    url: '/.well-known/oauth-authorization-server',
  });

  assert.equal(protectedResourceResponse.statusCode, 200);
  assert.deepEqual(protectedResourceResponse.json(), {
    resource: 'http://test-api.invalid/mcp',
    authorization_servers: ['http://test-api.invalid'],
    scopes_supported: ['shadowcook:recipes'],
  });
  assert.equal(authorizationServerResponse.statusCode, 200);
  assert.deepEqual(authorizationServerResponse.json(), {
    issuer: 'http://test-api.invalid',
    authorization_endpoint: 'http://test-api.invalid/oauth/authorize',
    token_endpoint: 'http://test-api.invalid/oauth/token',
    registration_endpoint: 'http://test-api.invalid/oauth/register',
    client_id_metadata_document_supported: true,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['shadowcook:recipes'],
  });
});

test('MCP advertises OAuth metadata when bearer authentication is absent', async (): Promise<void> => {
  const response = await api.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(
    response.headers['www-authenticate'],
    'Bearer resource_metadata="http://test-api.invalid/.well-known/oauth-protected-resource", scope="shadowcook:recipes"',
  );
});

test('authorization-code login issues a rotating refresh token accepted by MCP', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'mcp-oauth@example.test',
  });
  await assignTenantRole(database.pool, user.principalId, 'mcp-oauth', [
    'recipe:read',
    'recipe:create',
    'recipe:update',
  ]);
  const cookie: string = await loginCookie(user);
  const registrationResponse = await api.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      redirect_uris: ['https://client.example.test/oauth/callback'],
      client_name: 'MCP test client',
    },
  });
  assert.equal(registrationResponse.statusCode, 201);
  const registration: OAuthClientRegistration = registrationResponse.json();

  const verifier: string = 'mcp-oauth-test-code-verifier-with-sufficient-entropy';
  const challenge: string = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const authorizationQuery: URLSearchParams = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: 'https://client.example.test/oauth/callback',
    state: 'test-state',
    resource: 'http://test-api.invalid/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const authorizationResponse = await api.inject({
    method: 'GET',
    url: `/oauth/authorize?${authorizationQuery.toString()}`,
    headers: { cookie },
  });
  assert.equal(authorizationResponse.statusCode, 302);
  const callback: URL = new URL(requiredHeader(authorizationResponse.headers.location));
  assert.equal(callback.origin, 'https://client.example.test');
  assert.equal(callback.pathname, '/oauth/callback');
  assert.equal(callback.searchParams.get('state'), 'test-state');
  const authorizationCode: string = requiredParameter(callback, 'code');

  const tokenResponse = await api.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: 'https://client.example.test/oauth/callback',
      client_id: registration.client_id,
      code_verifier: verifier,
      resource: 'http://test-api.invalid/mcp',
    }).toString(),
  });
  assert.equal(tokenResponse.statusCode, 200);
  const tokens: OAuthTokenResponse = tokenResponse.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, 'shadowcook:recipes');

  const initializeResponse = await api.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${tokens.access_token}` },
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });
  assert.equal(initializeResponse.statusCode, 200);
  assert.deepEqual(initializeResponse.json(), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'shadowcook', version: '2.0' },
    },
  });

  const createDraftResponse = await api.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${tokens.access_token}` },
    payload: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'create_recipe_draft',
        arguments: {
          tenantSlug: 'mcp-oauth',
          recipe: {
            title: 'OAuth MCP draft',
            slug: 'oauth-mcp-draft',
            summary: 'Created through the restored MCP adapter.',
            categoryPublicIds: [],
          },
        },
      },
    },
  });
  assert.equal(createDraftResponse.statusCode, 200);
  const createDraftResult = createDraftResponse.json<{
    result: { content: { type: string; text: string }[]; isError: boolean };
  }>();
  assert.equal(createDraftResult.result.isError, false);
  const createdDraft: { title: string; isFeatured: boolean } = JSON.parse(
    createDraftResult.result.content[0]!.text,
  );
  assert.equal(createdDraft.title, 'OAuth MCP draft');
  assert.equal(createdDraft.isFeatured, true);

  const refreshedResponse = await refreshToken(registration.client_id, tokens.refresh_token);
  assert.equal(refreshedResponse.statusCode, 200);
  const refreshedTokens: OAuthTokenResponse = refreshedResponse.json();
  assert.notEqual(refreshedTokens.refresh_token, tokens.refresh_token);

  const replayResponse = await refreshToken(registration.client_id, tokens.refresh_token);
  assert.equal(replayResponse.statusCode, 400);
  assert.deepEqual(replayResponse.json(), { error: 'invalid_grant' });
});

async function loginCookie(user: TestUser): Promise<string> {
  const response = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200);
  const setCookie: string = requiredHeader(response.headers['set-cookie']);
  const cookie: string | undefined = setCookie.split(';', 1)[0];
  if (cookie === undefined) throw new Error('Login did not return a session cookie.');
  return cookie;
}

async function refreshToken(
  clientId: string,
  refreshTokenValue: string,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  return api.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
      client_id: clientId,
    }).toString(),
  });
}

function requiredHeader(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && value[0] !== undefined) return value[0];
  throw new Error('Expected response header is missing.');
}

function requiredParameter(url: URL, name: string): string {
  const value: string | null = url.searchParams.get(name);
  if (value === null) throw new Error(`Expected ${name} query parameter is missing.`);
  return value;
}
