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
