import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { MiddlewareHandler } from 'astro';
import { onRequest } from '../../src/middleware.ts';

type MiddlewareContext = Parameters<MiddlewareHandler>[0];
type MiddlewareNext = Parameters<MiddlewareHandler>[1];

function configureApiOrigin(context: TestContext): void {
  const previousOrigin: string | undefined = process.env.SHADOWCOOK_API_ORIGIN;
  process.env.SHADOWCOOK_API_ORIGIN = 'http://api.internal:3000';
  context.after((): void => {
    if (previousOrigin === undefined) delete process.env.SHADOWCOOK_API_ORIGIN;
    else process.env.SHADOWCOOK_API_ORIGIN = previousOrigin;
  });
}

async function proxyRequest(request: Request, next: MiddlewareNext): Promise<Response> {
  const context: MiddlewareContext = {
    request,
    url: new URL(request.url),
    clientAddress: '198.51.100.25',
  } as MiddlewareContext;
  const response: Response | void = await onRequest(context, next);
  assert.ok(response instanceof Response);
  return response;
}

function unexpectedWebFallback(): Promise<Response> {
  assert.fail('API requests must not render a web page.');
}

test('logout origin rejections are logged before forwarding without exposing credentials', async (context: TestContext): Promise<void> => {
  const records: string[] = [];
  context.mock.method(console, 'info', (record: string): void => {
    records.push(record);
  });
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    assert.fail('Rejected requests must not reach the API.');
  });
  const response: Response = await proxyRequest(
    new Request('https://web.invalid/api/auth/logout?token=secret-query', {
      method: 'POST',
      headers: { origin: 'http://web.invalid', cookie: 'shadowcook_session=secret-cookie' },
    }),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 403);
  assert.equal(await response.text(), '');
  assert.equal(records.length, 2);
  const incoming: Record<string, unknown> = JSON.parse(records[0]!);
  const rejected: Record<string, unknown> = JSON.parse(records[1]!);
  assert.equal(incoming.event, 'authentication-request');
  assert.equal(incoming.originPresent, true);
  assert.equal(incoming.originMatches, false);
  assert.equal(incoming.contentTypePresent, false);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.failureReason, 'origin-rejected');
  assert.match(String(rejected.time), /Z$/);
  assert.doesNotMatch(records.join('\n'), /secret-query|secret-cookie/);
});

test('logout upstream failures are logged with their stage', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const records: string[] = [];
  context.mock.method(console, 'info', (record: string): void => {
    records.push(record);
  });
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new TypeError('Connection refused');
  });
  const response: Response = await proxyRequest(
    new Request('https://web.invalid/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 503);
  const failed: Record<string, unknown> = JSON.parse(records[1]!);
  assert.equal(failed.status, 503);
  assert.equal(failed.failureReason, 'upstream-unavailable');
});

test('JSON logout without Origin reaches the API and preserves cookie expiration', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const expiredCookie: string = 'shadowcook_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  context.mock.method(
    globalThis,
    'fetch',
    async (url: URL, options: RequestInit): Promise<Response> => {
      assert.equal(url.href, 'http://api.internal:3000/auth/logout');
      assert.equal(options.method, 'POST');
      const headers: Headers = new Headers(options.headers);
      assert.equal(headers.get('cookie'), 'shadowcook_session=current-session');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.ok(options.body instanceof ArrayBuffer);
      assert.equal(new TextDecoder().decode(options.body), '{}');
      return new Response(null, {
        status: 204,
        headers: { 'set-cookie': expiredCookie, 'cache-control': 'no-store' },
      });
    },
  );
  const response: Response = await proxyRequest(
    new Request('http://web.invalid/api/auth/logout', {
      method: 'POST',
      headers: { cookie: 'shadowcook_session=current-session', 'content-type': 'application/json' },
      body: '{}',
    }),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('set-cookie'), expiredCookie);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('cookbook ZIP downloads preserve binary content, attachment headers and authentication through the proxy', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const bytes: Uint8Array = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0xff]);
  const disposition: string = 'attachment; filename="cookbook-20261013T190000Z.shadowcook.zip"';
  context.mock.method(
    globalThis,
    'fetch',
    async (url: URL, options: RequestInit): Promise<Response> => {
      assert.equal(url.href, 'http://api.internal:3000/cookbook/tenants/cookbook/export');
      assert.equal(new Headers(options.headers).get('cookie'), 'shadowcook_session=export-session');
      assert.equal(new Headers(options.headers).get('x-forwarded-for'), '198.51.100.25');
      return new Response(bytes, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': disposition,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    },
  );
  const response: Response = await proxyRequest(
    new Request('http://web.invalid/api/cookbook/tenants/cookbook/export', {
      headers: { cookie: 'shadowcook_session=export-session' },
    }),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), disposition);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('both public MCP paths preserve initialize requests and JSON-RPC responses', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const body: string = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' });
  const result: string = JSON.stringify({ jsonrpc: '2.0', id: 0, result: { tools: {} } });
  context.mock.method(
    globalThis,
    'fetch',
    async (input: URL, options: RequestInit): Promise<Response> => {
      assert.equal(input.href, 'http://api.internal:3000/mcp?transport=http');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.body instanceof ArrayBuffer);
      assert.equal(new TextDecoder().decode(options.body), body);
      const headers: Headers = new Headers(options.headers);
      assert.equal(headers.get('authorization'), 'Bearer test-token');
      assert.equal(headers.get('accept'), 'application/json, text/event-stream');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(headers.get('mcp-protocol-version'), '2025-11-25');
      return new Response(result, { headers: { 'content-type': 'application/json' } });
    },
  );

  for (const pathname of ['/mcp', '/api/mcp']) {
    const request: Request = new Request(
      `https://cookbook.example.test${pathname}?transport=http`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
        },
        body,
      },
    );
    const response: Response = await proxyRequest(request, unexpectedWebFallback);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(await response.text(), result);
  }
});

test('the root MCP alias preserves the upstream OAuth challenge', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const challenge: string =
    'Bearer resource_metadata="https://cookbook.example.test/api/.well-known/oauth-protected-resource"';
  context.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> =>
      new Response(JSON.stringify({ error: 'OAuth authentication is required.' }), {
        status: 401,
        headers: { 'content-type': 'application/json', 'www-authenticate': challenge },
      }),
  );
  const request: Request = new Request('https://cookbook.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }),
  });
  const response: Response = await proxyRequest(request, unexpectedWebFallback);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), challenge);
  assert.deepEqual(await response.json(), { error: 'OAuth authentication is required.' });
});

test('OAuth discovery aliases reach the API metadata endpoints', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  const routes: Record<string, string> = {
    '/.well-known/oauth-protected-resource': '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp': '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp': '/.well-known/oauth-protected-resource',
    '/api/.well-known/oauth-protected-resource': '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api': '/.well-known/oauth-authorization-server',
    '/api/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server',
  };
  let expectedPath: string = '';
  context.mock.method(
    globalThis,
    'fetch',
    async (input: URL, options: RequestInit): Promise<Response> => {
      assert.equal(input.pathname, expectedPath);
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json({ resource: 'https://cookbook.example.test/api/mcp' });
    },
  );
  for (const [publicPath, apiPath] of Object.entries(routes)) {
    expectedPath = apiPath;
    const response: Response = await proxyRequest(
      new Request(`https://cookbook.example.test${publicPath}`),
      unexpectedWebFallback,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { resource: 'https://cookbook.example.test/api/mcp' });
  }
});

test('ordinary cookbook routes continue to the web renderer', async (context: TestContext): Promise<void> => {
  context.mock.method(globalThis, 'fetch', unexpectedWebFallback);
  for (const pathname of ['/my-cookbook', '/mcp-cookbook', '/.well-known/unrelated']) {
    const response: Response = await proxyRequest(
      new Request(`https://cookbook.example.test${pathname}`),
      async (): Promise<Response> => new Response('Cookbook page'),
    );
    assert.equal(await response.text(), 'Cookbook page');
  }
});

test('an unreachable API returns safe JSON without a page fallback', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new TypeError('private upstream address');
  });
  const response: Response = await proxyRequest(
    new Request('https://cookbook.example.test/api/cookbook'),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    code: 'UPSTREAM_UNAVAILABLE',
    error: 'Service unavailable',
  });
});

test('session outages and forbidden sessions do not redirect to login', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  for (const status of [403, 500, 503]) {
    context.mock.method(
      globalThis,
      'fetch',
      async (): Promise<Response> => new Response('Private details', { status }),
    );
    const response: Response = await proxyRequest(
      new Request('https://cookbook.example.test/admin'),
      unexpectedWebFallback,
    );
    assert.equal(response.status, status === 403 ? 403 : 503);
    assert.equal(response.headers.get('location'), null);
    assert.doesNotMatch(await response.text(), /Private details/);
  }
});

test('expired sessions preserve the destination in the login redirect', async (context: TestContext): Promise<void> => {
  configureApiOrigin(context);
  context.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> => new Response(null, { status: 401 }),
  );
  const response: Response = await proxyRequest(
    new Request('https://cookbook.example.test/family/recipes/new?categoryPublicId=cakes'),
    unexpectedWebFallback,
  );
  assert.equal(response.status, 302);
  const target: URL = new URL(response.headers.get('location')!);
  assert.equal(target.pathname, '/login');
  assert.equal(target.searchParams.get('next'), '/family/recipes/new?categoryPublicId=cakes');
});
