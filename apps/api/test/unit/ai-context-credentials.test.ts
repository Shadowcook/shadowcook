import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { aiContextTokenFromRequest } from '../../src/auth/ai-context-token.js';
import { replyWithNotFound, serializeRequestForLog } from '../../src/security/request-logging.js';

test('AI context credentials accept a single header or URL-encoded query token', (): void => {
  assert.equal(
    aiContextTokenFromRequest({
      url: '/ai-context/reader',
      headers: { authorization: 'Bearer token_123' },
    }),
    'token_123',
  );
  assert.equal(
    aiContextTokenFromRequest({
      url: '/ai-context/reader?other=value&access_token=token%5F123',
      headers: {},
    }),
    'token_123',
  );
  for (const url of [
    '/ai-context/reader',
    '/ai-context/reader?access_token=',
    '/ai-context/reader?access_token=bad%20token',
    '/ai-context/reader?access_token=one&access_token=two',
    '/ai-context/reader?access_token[]=token',
  ]) {
    assert.equal(aiContextTokenFromRequest({ url, headers: {} }), null);
  }
  for (const authorization of ['Basic invalid', 'Bearer token_123']) {
    assert.equal(
      aiContextTokenFromRequest({
        url: '/ai-context/reader?access_token=token_123',
        headers: { authorization },
      }),
      null,
    );
  }
});

test('Fastify request logs redact query credentials and bootstrap tokens without altering requests', async (): Promise<void> => {
  const messages: string[] = [];
  const api: FastifyInstance = Fastify({
    logger: {
      serializers: { req: serializeRequestForLog },
      stream: {
        write: (message: string): void => {
          messages.push(message);
        },
      },
    },
  });
  api.setNotFoundHandler(replyWithNotFound);
  api.get('/ai-context/reader', async (request): Promise<{ url: string }> => ({
    url: request.url,
  }));
  api.get('/ai-context/:bootstrapToken', async (): Promise<object> => ({}));
  try {
    const url: string =
      '/ai-context/reader?other=visible&access%5Ftoken=reader-secret&access_token=second-secret';
    const response: LightMyRequestResponse = await api.inject({ method: 'GET', url });
    assert.equal(response.json<{ url: string }>().url, url);
    await api.inject({ method: 'GET', url: '/ai-context/bootstrap-secret' });
    const missing: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/missing?access_token=missing-route-secret',
    });
    assert.equal(missing.statusCode, 404);
    assert.ok(!missing.body.includes('missing-route-secret'));
    const logs: string = messages.join('');
    assert.ok(messages.length > 0);
    assert.ok(!logs.includes('reader-secret'));
    assert.ok(!logs.includes('second-secret'));
    assert.ok(!logs.includes('bootstrap-secret'));
    assert.ok(!logs.includes('missing-route-secret'));
    assert.ok(logs.includes('other=visible'));
    assert.ok(logs.includes('REDACTED'));
  } finally {
    await api.close();
  }
});
