import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
  type LightMyRequestResponse,
} from 'fastify';
import { registerErrorHandling } from '../../src/security/error-handling.js';

test('unexpected exceptions are safe JSON with a correlation header; domain responses survive', async (): Promise<void> => {
  const api: FastifyInstance = Fastify();
  registerErrorHandling(api);
  api.get('/broken', async (): Promise<void> => {
    throw new Error('SQL password /private/server/path');
  });
  api.post(
    '/input',
    {
      schema: {
        body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      },
    },
    async (): Promise<object> => ({}),
  );
  api.get('/domain', async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
    reply.code(409).send({ code: 'RECIPE_CONFLICT', error: 'Choose another slug' }),
  );
  try {
    const response: LightMyRequestResponse = await api.inject('/broken');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().code, 'INTERNAL_SERVER_ERROR');
    assert.ok(response.headers['x-request-id']);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.doesNotMatch(response.body, /SQL|password|private|stack/);
    const validation: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/input',
      payload: {},
    });
    assert.equal(validation.statusCode, 400);
    assert.equal(validation.json().code, 'VALIDATION_ERROR');
    const domain: LightMyRequestResponse = await api.inject('/domain');
    assert.equal(domain.statusCode, 409);
    assert.equal(domain.json().code, 'RECIPE_CONFLICT');
  } finally {
    await api.close();
  }
});
