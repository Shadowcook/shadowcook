import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

interface ProxyContext {
  request: Request;
  url: URL;
  clientAddress: string;
  isPrerendered: boolean;
}

interface WebMiddleware {
  onRequest(context: ProxyContext, next: () => Promise<Response>): Promise<Response>;
}

export async function createPublicApiClient(
  context: TestContext,
  api: FastifyInstance,
): Promise<(request: Request) => Promise<Response>> {
  const previousOrigin: string | undefined = process.env.SHADOWCOOK_API_ORIGIN;
  const internalOrigin: string = 'http://isolated-api.invalid';
  process.env.SHADOWCOOK_API_ORIGIN = internalOrigin;
  context.after((): void => {
    if (previousOrigin === undefined) delete process.env.SHADOWCOOK_API_ORIGIN;
    else process.env.SHADOWCOOK_API_ORIGIN = previousOrigin;
  });
  // Load the actual web middleware without adding the web build to the API compiler inputs.
  const middleware: WebMiddleware = await import(
    new URL('../../../web/src/middleware.ts', import.meta.url).href
  );
  context.mock.method(
    globalThis,
    'fetch',
    async (url: URL, options: RequestInit): Promise<Response> => {
      assert.equal(url.origin, internalOrigin);
      const headers: Record<string, string> = Object.fromEntries(new Headers(options.headers));
      const result: LightMyRequestResponse = await api.inject({
        method: options.method as HttpMethod,
        url: `${url.pathname}${url.search}`,
        headers,
        payload: options.body instanceof ArrayBuffer ? Buffer.from(options.body) : undefined,
      });
      const responseHeaders: Headers = new Headers();
      for (const [name, value] of Object.entries(result.headers)) {
        if (value !== undefined) responseHeaders.set(name, String(value));
      }
      return new Response(result.body, { status: result.statusCode, headers: responseHeaders });
    },
  );
  return async (request: Request): Promise<Response> =>
    middleware.onRequest(
      {
        request,
        url: new URL(request.url),
        clientAddress: '198.51.100.20',
        isPrerendered: false,
      },
      async (): Promise<Response> =>
        new Response('Web page, not an API endpoint.', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
    );
}
