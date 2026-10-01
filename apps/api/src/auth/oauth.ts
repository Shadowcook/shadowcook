import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { currentSessionUser } from './session.js';

const scope: string = 'shadowcook:recipes';
const authorizationCodeLifetimeMilliseconds: number = 5 * 60 * 1000;
const accessTokenLifetimeMilliseconds: number = 60 * 60 * 1000;
const refreshTokenLifetimeMilliseconds: number = 30 * 24 * 60 * 60 * 1000;

interface AuthorizationRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

interface AuthorizationCodeRow {
  id: string;
  principal_id: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  scope: string;
  code_challenge: string;
}

interface RefreshTokenRow {
  id: string;
  principal_id: string;
  client_id: string;
  resource: string;
  scope: string;
}

export function registerOAuthRoutes(
  api: FastifyInstance,
  pool: Pool,
  publicWebOrigin: string,
  publicApiOrigin: string,
): void {
  api.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request: FastifyRequest, body: string, done): void => done(null, body),
  );
  api.get('/.well-known/oauth-protected-resource', async (_request, reply) =>
    reply.send({
      resource: `${publicApiOrigin}/mcp`,
      authorization_servers: [publicApiOrigin],
      scopes_supported: [scope],
    }),
  );
  api.get('/.well-known/oauth-authorization-server', async (_request, reply) =>
    reply.send(authorizationServerMetadata(publicApiOrigin)),
  );
  api.post('/oauth/register', async (request, reply) => {
    const input: { redirectUris: string[]; clientName: string } | null = parseRegistration(
      request.body,
    );
    if (input === null) return oauthError(reply, 400, 'invalid_client_metadata');
    const clientId: string = randomBytes(24).toString('base64url');
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO oauth_client (client_id, client_name) VALUES ($1, $2) RETURNING id',
        [clientId, input.clientName],
      );
      for (const redirectUri of input.redirectUris)
        await client.query(
          'INSERT INTO oauth_client_redirect_uri (oauth_client_id, redirect_uri) VALUES ($1, $2)',
          [inserted.rows[0]!.id, redirectUri],
        );
      await client.query('COMMIT');
      return reply.code(201).send({ client_id: clientId, token_endpoint_auth_method: 'none' });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  api.get('/oauth/authorize', async (request, reply) => {
    const authorization: AuthorizationRequest | null = parseAuthorizationRequest(
      request,
      publicApiOrigin,
    );
    if (authorization === null) {
      logOAuthRequest(request, 'authorize', 'invalid_request');
      return oauthError(reply, 400, 'invalid_request');
    }
    if (!(await isKnownRedirectUri(pool, authorization.clientId, authorization.redirectUri))) {
      logOAuthRequest(request, 'authorize', 'unknown_client_or_redirect_uri');
      return oauthError(reply, 400, 'invalid_client');
    }
    const user = await currentSessionUser(pool, request);
    if (user === null || user.disabled_at !== null) {
      logOAuthRequest(request, 'authorize', 'login_required');
      return reply.redirect(loginUrl(publicWebOrigin, request.url));
    }
    const code: string = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO oauth_authorization_code
       (code_hash, principal_id, client_id, redirect_uri, resource, scope, code_challenge, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        hashToken(code),
        user.principal_id,
        authorization.clientId,
        authorization.redirectUri,
        authorization.resource,
        authorization.scope,
        authorization.codeChallenge,
        new Date(Date.now() + authorizationCodeLifetimeMilliseconds),
      ],
    );
    const target: URL = new URL(authorization.redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', authorization.state);
    target.searchParams.set('iss', publicApiOrigin);
    logOAuthRequest(request, 'authorize', 'authorization_code_issued');
    return reply.redirect(target.toString());
  });
  api.post('/oauth/token', async (request, reply) => {
    const parameters: URLSearchParams = new URLSearchParams(String(request.body ?? ''));
    const grantType: string | null = parameters.get('grant_type');
    if (grantType === 'authorization_code')
      return exchangeAuthorizationCode(pool, request, reply, parameters);
    if (grantType === 'refresh_token')
      return exchangeRefreshToken(pool, request, reply, parameters);
    logOAuthRequest(request, 'token', 'unsupported_grant_type');
    return oauthError(reply, 400, 'unsupported_grant_type');
  });
}

function authorizationServerMetadata(publicApiOrigin: string): object {
  return {
    issuer: publicApiOrigin,
    authorization_endpoint: `${publicApiOrigin}/oauth/authorize`,
    token_endpoint: `${publicApiOrigin}/oauth/token`,
    registration_endpoint: `${publicApiOrigin}/oauth/register`,
    authorization_response_iss_parameter_supported: true,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [scope],
  };
}

async function exchangeAuthorizationCode(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  parameters: URLSearchParams,
): Promise<FastifyReply> {
  const code: string | null = parameters.get('code');
  const redirectUri: string | null = parameters.get('redirect_uri');
  const clientId: string | null = parameters.get('client_id');
  const verifier: string | null = parameters.get('code_verifier');
  const resource: string | null = parameters.get('resource');
  if (code === null || redirectUri === null || clientId === null || verifier === null) {
    logOAuthRequest(request, 'token', 'authorization_code_request_invalid');
    return oauthError(reply, 400, 'invalid_request');
  }
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<AuthorizationCodeRow>(
      `SELECT id, principal_id, client_id, redirect_uri, resource, scope, code_challenge
       FROM oauth_authorization_code
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hashToken(code)],
    );
    const authorization: AuthorizationCodeRow | undefined = result.rows[0];
    if (
      authorization === undefined ||
      authorization.client_id !== clientId ||
      authorization.redirect_uri !== redirectUri ||
      (resource !== null && authorization.resource !== resource) ||
      !safeEqual(pkceChallenge(verifier), authorization.code_challenge)
    ) {
      await client.query('ROLLBACK');
      logOAuthRequest(request, 'token', 'authorization_code_invalid');
      return oauthError(reply, 400, 'invalid_grant');
    }
    await client.query('UPDATE oauth_authorization_code SET consumed_at = now() WHERE id = $1', [
      authorization.id,
    ]);
    const tokens = await issueTokens(client, authorization);
    await client.query('COMMIT');
    logOAuthRequest(request, 'token', 'authorization_code_exchanged');
    return reply.send(tokens);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function exchangeRefreshToken(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  parameters: URLSearchParams,
): Promise<FastifyReply> {
  const refreshToken: string | null = parameters.get('refresh_token');
  const clientId: string | null = parameters.get('client_id');
  if (refreshToken === null || clientId === null) {
    logOAuthRequest(request, 'token', 'refresh_token_request_invalid');
    return oauthError(reply, 400, 'invalid_request');
  }
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<RefreshTokenRow>(
      `SELECT id, principal_id, client_id, resource, scope
       FROM oauth_refresh_token
       WHERE token_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hashToken(refreshToken)],
    );
    const stored: RefreshTokenRow | undefined = result.rows[0];
    if (stored === undefined || stored.client_id !== clientId) {
      await client.query('ROLLBACK');
      logOAuthRequest(request, 'token', 'refresh_token_invalid');
      return oauthError(reply, 400, 'invalid_grant');
    }
    await client.query('UPDATE oauth_refresh_token SET consumed_at = now() WHERE id = $1', [
      stored.id,
    ]);
    const tokens = await issueTokens(client, stored);
    await client.query('COMMIT');
    logOAuthRequest(request, 'token', 'refresh_token_exchanged');
    return reply.send(tokens);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function issueTokens(
  client: PoolClient,
  authorization: Pick<AuthorizationCodeRow, 'principal_id' | 'client_id' | 'resource' | 'scope'>,
): Promise<object> {
  const accessToken: string = randomBytes(32).toString('base64url');
  const refreshToken: string = randomBytes(32).toString('base64url');
  await client.query(
    'INSERT INTO oauth_access_token (token_hash, principal_id, client_id, resource, scope, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      hashToken(accessToken),
      authorization.principal_id,
      authorization.client_id,
      authorization.resource,
      authorization.scope,
      new Date(Date.now() + accessTokenLifetimeMilliseconds),
    ],
  );
  await client.query(
    'INSERT INTO oauth_refresh_token (token_hash, principal_id, client_id, resource, scope, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      hashToken(refreshToken),
      authorization.principal_id,
      authorization.client_id,
      authorization.resource,
      authorization.scope,
      new Date(Date.now() + refreshTokenLifetimeMilliseconds),
    ],
  );
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTokenLifetimeMilliseconds / 1000,
    refresh_token: refreshToken,
    scope: authorization.scope,
  };
}

function parseAuthorizationRequest(
  request: FastifyRequest,
  publicApiOrigin: string,
): AuthorizationRequest | null {
  const query = request.query as Record<string, unknown>;
  const responseType = query.response_type;
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const state = query.state;
  const resource = query.resource;
  const requestedScope: unknown = query.scope ?? scope;
  const codeChallenge = query.code_challenge;
  const codeChallengeMethod = query.code_challenge_method;
  if (
    responseType !== 'code' ||
    typeof clientId !== 'string' ||
    typeof redirectUri !== 'string' ||
    typeof state !== 'string' ||
    typeof resource !== 'string' ||
    typeof requestedScope !== 'string' ||
    typeof codeChallenge !== 'string' ||
    typeof codeChallengeMethod !== 'string' ||
    !strings([
      clientId,
      redirectUri,
      state,
      resource,
      requestedScope,
      codeChallenge,
      codeChallengeMethod,
    ])
  )
    return null;
  if (
    resource !== `${publicApiOrigin}/mcp` ||
    requestedScope.split(' ').some((value: string): boolean => value !== scope) ||
    codeChallengeMethod !== 'S256' ||
    !isHttpsUrl(redirectUri)
  )
    return null;
  return {
    responseType,
    clientId,
    redirectUri,
    state,
    resource,
    scope: requestedScope,
    codeChallenge,
    codeChallengeMethod,
  };
}

async function isKnownRedirectUri(
  pool: Pool,
  clientId: string,
  redirectUri: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM oauth_client
     INNER JOIN oauth_client_redirect_uri ON oauth_client_redirect_uri.oauth_client_id = oauth_client.id
     WHERE oauth_client.client_id = $1 AND oauth_client_redirect_uri.redirect_uri = $2`,
    [clientId, redirectUri],
  );
  return result.rowCount === 1;
}

function logOAuthRequest(
  request: FastifyRequest,
  flow: 'authorize' | 'token',
  outcome: string,
): void {
  request.log.info({ flow, outcome }, 'OAuth request processed');
}

function parseRegistration(value: unknown): { redirectUris: string[]; clientName: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const redirectUris = body.redirect_uris;
  const clientName = body.client_name;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((uri: unknown): boolean => typeof uri === 'string' && isHttpsUrl(uri)) ||
    typeof clientName !== 'string' ||
    clientName.trim().length === 0 ||
    clientName.trim().length > 160
  )
    return null;
  return { redirectUris: [...new Set(redirectUris)], clientName: clientName.trim() };
}

function loginUrl(publicWebOrigin: string, requestUrl: string): string {
  const target: URL = new URL(`${publicWebOrigin}/login`);
  target.searchParams.set('next', `/api${requestUrl}`);
  return target.toString();
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_error: unknown) {
    return false;
  }
}
function strings(values: unknown[]): values is string[] {
  return values.every((value: unknown): boolean => typeof value === 'string' && value.length > 0);
}
function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}
function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function oauthError(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ error });
}
