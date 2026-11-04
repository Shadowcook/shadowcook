import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ApiRequestError, request } from '../../src/lib/api/client.ts';

for (const body of ['<html>secret proxy details</html>', '', '{broken', '{"error":"SQL secret"}']) {
  test(`non-domain error body is safely classified: ${JSON.stringify(body)}`, async (context: TestContext): Promise<void> => {
    context.mock.method(
      globalThis,
      'fetch',
      async (): Promise<Response> => new Response(body, { status: 502 }),
    );
    await assert.rejects(request('/cookbook'), (error: unknown): boolean => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'REQUEST_FAILED');
      assert.doesNotMatch(error.message, /secret|SQL|html/);
      return true;
    });
  });
}
test('domain errors retain status, request identifier and Retry-After without repeating writes', async (context: TestContext): Promise<void> => {
  let calls: number = 0;
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    calls += 1;
    return Response.json(
      { code: 'LOGIN_RATE_LIMITED', error: 'Do not display raw text' },
      {
        status: 429,
        headers: { 'x-request-id': 'support-123', 'retry-after': '30' },
      },
    );
  });
  await assert.rejects(
    request('/save', { method: 'POST', body: 'draft' }),
    (error: unknown): boolean => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 30);
      assert.equal(error.requestId, 'support-123');
      assert.equal(error.code, 'LOGIN_RATE_LIMITED');
      return true;
    },
  );
  assert.equal(calls, 1);
});
test('network failure has no invented HTTP status; cancellation stays cancellation', async (context: TestContext): Promise<void> => {
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new TypeError('offline');
  });
  await assert.rejects(request('/cookbook'), (error: unknown): boolean => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.status, undefined);
    return true;
  });
  const abort: DOMException = new DOMException('Cancelled', 'AbortError');
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw abort;
  });
  await assert.rejects(request('/cookbook'), (error: unknown): boolean => error === abort);
});
