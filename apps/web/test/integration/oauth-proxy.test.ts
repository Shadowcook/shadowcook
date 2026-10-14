import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readdir } from 'node:fs/promises';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxyAwareHandler } from '../../src/lib/server/client-address.ts';

interface ForwardedRequest {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

interface PublicDomain {
  hostname: string;
  protocol: 'http' | 'https';
  port?: string;
}

const previousEnvironment: Record<string, string | undefined> = {
  ASTRO_NODE_AUTOSTART: process.env.ASTRO_NODE_AUTOSTART,
  SHADOWCOOK_API_ORIGIN: process.env.SHADOWCOOK_API_ORIGIN,
};
const forwardedRequests: ForwardedRequest[] = [];
let apiServer: Server | undefined;
let webServer: Server | undefined;
let webOrigin: string;
let browserOrigin: string;

before(async (): Promise<void> => {
  apiServer = createServer((request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer): void => {
      chunks.push(chunk);
    });
    request.on('end', (): void => {
      const body: string = Buffer.concat(chunks).toString('utf8');
      forwardedRequests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/oauth/token') {
        const parameters: URLSearchParams = new URLSearchParams(body);
        if (parameters.get('grant_type') === 'unsupported') {
          response.writeHead(400);
          response.end(JSON.stringify({ error: 'unsupported_grant_type' }));
        } else {
          response.end(JSON.stringify({ access_token: 'test-access-token', token_type: 'Bearer' }));
        }
      } else {
        response.end(JSON.stringify({ forwarded: true }));
      }
    });
  });
  process.env.SHADOWCOOK_API_ORIGIN = await listen(apiServer);
  process.env.ASTRO_NODE_AUTOSTART = 'disabled';
  const entrypoint: URL = new URL('../../dist/server/entry.mjs', import.meta.url);
  const runtime: { handler: RequestListener } = await import(entrypoint.href);
  const serverDirectory: URL = new URL('../../dist/server/', import.meta.url);
  const artifactNames: string[] = await readdir(serverDirectory);
  const manifestName: string | undefined = artifactNames.find(
    (name: string): boolean => name.startsWith('manifest_') && name.endsWith('.mjs'),
  );
  assert.ok(manifestName);
  const artifact: { manifest: { allowedDomains: PublicDomain[] } } = await import(
    new URL(manifestName, serverDirectory).href
  );
  const publicDomain: PublicDomain | undefined = artifact.manifest.allowedDomains[0];
  const publicUrl: URL = new URL(
    publicDomain === undefined
      ? 'http://localhost'
      : `${publicDomain.protocol}://${publicDomain.hostname}${publicDomain.port === undefined ? '' : `:${publicDomain.port}`}`,
  );
  browserOrigin = publicUrl.origin;
  const handler: RequestListener = createProxyAwareHandler(runtime.handler, []);
  webServer = createServer((request: IncomingMessage, response: ServerResponse): void => {
    if (publicDomain !== undefined) {
      request.headers['x-forwarded-host'] = publicUrl.host;
      request.headers['x-forwarded-proto'] = publicDomain.protocol;
    }
    handler(request, response);
  });
  webOrigin = await listen(webServer);
});

after(async (): Promise<void> => {
  await Promise.all([close(webServer), close(apiServer)]);
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('the built Astro proxy forwards external and Origin-less authorization-code forms', async (): Promise<void> => {
  const body: string = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'test-authorization-code',
    code_verifier: 'test-pkce-verifier',
    redirect_uri: 'http://127.0.0.1:6274/oauth/callback',
    resource: `${webOrigin}/api/mcp`,
    client_id: 'test-client-id',
  }).toString();
  for (const origin of ['http://127.0.0.1:6274', null]) {
    const headers: Headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    });
    if (origin !== null) headers.set('origin', origin);
    const response: Response = await fetch(`${webOrigin}/api/oauth/token`, {
      method: 'POST',
      headers,
      body,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await response.json(), {
      access_token: 'test-access-token',
      token_type: 'Bearer',
    });
    const forwarded: ForwardedRequest | undefined = forwardedRequests.at(-1);
    assert.ok(forwarded);
    assert.equal(forwarded.method, 'POST');
    assert.equal(forwarded.path, '/oauth/token');
    assert.equal(forwarded.headers.origin ?? null, origin);
    assert.equal(forwarded.body, body);
  }
});

test('the built Astro proxy forwards refresh-token forms', async (): Promise<void> => {
  const body: string = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: 'test-refresh-token',
    client_id: 'test-client-id',
  }).toString();
  const response: Response = await fetch(`${webOrigin}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  assert.equal(response.status, 200);
  await response.json();
  assert.equal(forwardedRequests.at(-1)?.body, body);
});

test('the built Astro proxy preserves OAuth JSON error responses', async (): Promise<void> => {
  const response: Response = await fetch(`${webOrigin}/api/oauth/token`, {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:6274',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=unsupported',
  });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.deepEqual(await response.json(), { error: 'unsupported_grant_type' });
});

test('the built Astro runtime blocks other external form POSTs before forwarding or rendering', async (): Promise<void> => {
  const requestCount: number = forwardedRequests.length;
  for (const pathname of ['/api/auth/logout', '/login', '/api/oauth/token/extra']) {
    for (const origin of ['http://127.0.0.1:6274', null]) {
      const headers: Headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
      if (origin !== null) headers.set('origin', origin);
      const response: Response = await fetch(`${webOrigin}${pathname}`, {
        method: 'POST',
        headers,
        body: 'field=value',
      });
      assert.equal(response.status, 403, pathname);
      await response.text();
    }
  }
  assert.equal(forwardedRequests.length, requestCount);
});

test('the built Astro proxy still forwards same-origin forms', async (): Promise<void> => {
  const response: Response = await fetch(`${webOrigin}/api/auth/logout`, {
    method: 'POST',
    headers: { origin: browserOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'field=value',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { forwarded: true });
  assert.equal(forwardedRequests.at(-1)?.path, '/auth/logout');
});

test('the built proxy replaces spoofed IP headers for a direct visitor', async (): Promise<void> => {
  const response: Response = await fetch(`${webOrigin}/api/auth/authentication-methods`, {
    headers: {
      'x-forwarded-for': '203.0.113.1',
      forwarded: 'for=203.0.113.2',
      'x-real-ip': '203.0.113.3',
    },
  });
  assert.equal(response.status, 200);
  await response.json();
  const forwarded: ForwardedRequest | undefined = forwardedRequests.at(-1);
  assert.ok(forwarded);
  assert.equal(forwarded.headers['x-forwarded-for'], '127.0.0.1');
  assert.equal(forwarded.headers.forwarded, undefined);
  assert.equal(forwarded.headers['x-real-ip'], undefined);
});

test('the built proxy preserves the visitor IP established by a trusted edge proxy', async (): Promise<void> => {
  const runtime: { handler: RequestListener } = await import(
    new URL('../../dist/server/entry.mjs', import.meta.url).href
  );
  const server: Server = createServer(createProxyAwareHandler(runtime.handler, ['loopback']));
  try {
    const origin: string = await listen(server);
    const response: Response = await fetch(`${origin}/api/auth/authentication-methods`, {
      headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.25' },
    });
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(forwardedRequests.at(-1)?.headers['x-forwarded-for'], '198.51.100.25');
  } finally {
    await close(server);
  }
});

async function listen(server: Server): Promise<string> {
  return new Promise<string>(
    (resolve: (origin: string) => void, reject: (error: Error) => void): void => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', (): void => {
        server.off('error', reject);
        const address: AddressInfo | string | null = server.address();
        assert.ok(address !== null && typeof address !== 'string');
        resolve(`http://127.0.0.1:${address.port}`);
      });
    },
  );
}

async function close(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return;
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.close((error: Error | undefined): void => {
      if (error !== undefined) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
}
