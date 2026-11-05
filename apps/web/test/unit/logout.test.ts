import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ApiRequestError } from '../../src/lib/api/client.ts';
import { logout } from '../../src/lib/api/logout.ts';
import { isAllowedRequestOrigin } from '../../src/lib/server/request-origin.ts';

test('logout sends credentials and valid JSON accepted by the proxy even without Origin', async (context: TestContext): Promise<void> => {
  context.mock.method(
    globalThis,
    'fetch',
    async (path: string, options: RequestInit): Promise<Response> => {
      assert.equal(path, '/api/auth/logout');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(String(options.body)), {});
      const url: URL = new URL(path, 'http://web.invalid');
      assert.equal(isAllowedRequestOrigin(new Request(url, options), url), true);
      return new Response(null, { status: 204 });
    },
  );
  await logout();
});

for (const failure of ['network', 'timeout', 'server']) {
  test(`logout retries a ${failure} failure after possible server-side revocation`, async (context: TestContext): Promise<void> => {
    let calls: number = 0;
    context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        if (failure === 'network') throw new TypeError('Connection lost');
        if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 204 });
    });
    await logout();
    assert.equal(calls, 2);
  });
}

test('logout does not report success when revocation cannot be confirmed', async (context: TestContext): Promise<void> => {
  let calls: number = 0;
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    calls += 1;
    return new Response(null, { status: 503 });
  });
  await assert.rejects(
    logout(),
    (error: unknown): boolean => error instanceof ApiRequestError && error.status === 503,
  );
  assert.equal(calls, 2);
});

test('logout preserves request rejection instead of retrying forbidden requests', async (context: TestContext): Promise<void> => {
  let calls: number = 0;
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    calls += 1;
    return new Response(null, { status: 403 });
  });
  await assert.rejects(
    logout(),
    (error: unknown): boolean => error instanceof ApiRequestError && error.status === 403,
  );
  assert.equal(calls, 1);
});
