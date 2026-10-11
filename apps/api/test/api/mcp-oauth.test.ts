import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestUser, assignTenantRole, type TestUser } from '../helpers/actors.js';
import { createTestApi } from '../helpers/api.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface OAuthClientRegistration {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
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

const oauthCallbacks: { name: string; redirectUri: string; tenantSlug: string }[] = [
  {
    name: 'HTTPS',
    redirectUri: 'https://client.example.test/oauth/callback',
    tenantSlug: 'mcp-oauth-https',
  },
  {
    name: 'Inspector IPv4 loopback',
    redirectUri: 'http://127.0.0.1:6274/oauth/callback',
    tenantSlug: 'mcp-oauth-ipv4',
  },
  {
    name: 'IPv6 loopback',
    redirectUri: 'http://[::1]:6274/oauth/callback',
    tenantSlug: 'mcp-oauth-ipv6',
  },
];

for (const callback of oauthCallbacks) {
  test(`${callback.name} login issues a rotating refresh token accepted by MCP`, async (): Promise<void> => {
    await verifyOAuthLogin(callback.redirectUri, callback.tenantSlug);
  });
}

test('registration rejects unsafe callbacks and authorization rejects unregistered callbacks', async (): Promise<void> => {
  const unsafeUris: string[] = [
    'http://client.example.test/oauth/callback',
    'http://127.0.0.1.example.test:6274/oauth/callback',
    'http://user:password@127.0.0.1:6274/oauth/callback',
    'http://127.0.0.1:6274/oauth/callback#fragment',
  ];
  for (const uri of unsafeUris) {
    const response: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: [uri], client_name: 'Invalid callback client' },
    });
    assert.equal(response.statusCode, 400, uri);
    assert.deepEqual(response.json(), { error: 'invalid_client_metadata' });
  }

  const registrationResponse: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      redirect_uris: ['http://127.0.0.1:6274/oauth/callback'],
      client_name: 'Registered loopback client',
    },
  });
  assert.equal(registrationResponse.statusCode, 201);
  const registration: OAuthClientRegistration = registrationResponse.json();
  const query: URLSearchParams = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: 'http://127.0.0.1:6274/unregistered',
    state: 'test-state',
    resource: 'http://test-api.invalid/mcp',
    code_challenge: createHash('sha256').update('test-code-verifier').digest('base64url'),
    code_challenge_method: 'S256',
  });
  const authorizationResponse: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/oauth/authorize?${query.toString()}`,
  });
  assert.equal(authorizationResponse.statusCode, 400);
  assert.deepEqual(authorizationResponse.json(), { error: 'invalid_client' });
});

async function verifyOAuthLogin(redirectUri: string, tenantSlug: string): Promise<void> {
  const user: TestUser = await createTestUser(database.pool, {
    email: `${tenantSlug}@example.test`,
  });
  await assignTenantRole(database.pool, user.principalId, tenantSlug, [
    'recipe:read',
    'recipe:create',
    'recipe:update',
  ]);
  const cookie: string = await loginCookie(user);
  const registrationResponse: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'MCP Inspector',
      client_uri: 'https://github.com/modelcontextprotocol/inspector',
      scope: 'shadowcook:recipes',
      application_type: 'native',
    },
  });
  assert.equal(registrationResponse.statusCode, 201);
  const registration: OAuthClientRegistration = registrationResponse.json();
  assert.equal(registration.client_name, 'MCP Inspector');
  assert.deepEqual(registration.redirect_uris, [redirectUri]);
  assert.equal(registration.token_endpoint_auth_method, 'none');

  const verifier: string = 'mcp-oauth-test-code-verifier-with-sufficient-entropy';
  const challenge: string = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const authorizationQuery: URLSearchParams = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    state: 'test-state',
    resource: 'http://test-api.invalid/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const authorizationResponse: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: `/oauth/authorize?${authorizationQuery.toString()}`,
    headers: { cookie },
  });
  assert.equal(authorizationResponse.statusCode, 302);
  const callback: URL = new URL(requiredHeader(authorizationResponse.headers.location));
  assert.equal(callback.origin, new URL(redirectUri).origin);
  assert.equal(callback.pathname, '/oauth/callback');
  assert.equal(callback.searchParams.get('state'), 'test-state');
  const authorizationCode: string = requiredParameter(callback, 'code');

  const invalidParameters: Record<string, string>[] = [
    { redirect_uri: `${redirectUri}/different` },
    { code_verifier: 'incorrect-code-verifier' },
  ];
  for (const invalidParameter of invalidParameters) {
    const rejectedTokenResponse: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: redirectUri,
        client_id: registration.client_id,
        code_verifier: verifier,
        resource: 'http://test-api.invalid/mcp',
        ...invalidParameter,
      }).toString(),
    });
    assert.equal(rejectedTokenResponse.statusCode, 400);
    assert.deepEqual(rejectedTokenResponse.json(), { error: 'invalid_grant' });
  }

  const tokenResponse: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: redirectUri,
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

  const initializeResponse: LightMyRequestResponse = await api.inject({
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

  const createDraftResponse: LightMyRequestResponse = await api.inject({
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
          tenantSlug,
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
  const createDraftResult: {
    result: { content: { type: string; text: string }[]; isError: boolean };
  } = createDraftResponse.json();
  assert.equal(createDraftResult.result.isError, false);
  const createdDraft: { title: string; isFeatured: boolean } = JSON.parse(
    createDraftResult.result.content[0]!.text,
  );
  assert.equal(createdDraft.title, 'OAuth MCP draft');
  assert.equal(createdDraft.isFeatured, true);

  const refreshedResponse: LightMyRequestResponse = await refreshToken(
    registration.client_id,
    tokens.refresh_token,
  );
  assert.equal(refreshedResponse.statusCode, 200);
  const refreshedTokens: OAuthTokenResponse = refreshedResponse.json();
  assert.notEqual(refreshedTokens.refresh_token, tokens.refresh_token);

  const replayResponse: LightMyRequestResponse = await refreshToken(
    registration.client_id,
    tokens.refresh_token,
  );
  assert.equal(replayResponse.statusCode, 400);
  assert.deepEqual(replayResponse.json(), { error: 'invalid_grant' });
}

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
