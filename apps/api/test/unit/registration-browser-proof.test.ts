import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type LightMyRequestResponse,
  type FastifyInstance,
} from 'fastify';
import {
  matchesRegistrationBrowser,
  setRegistrationBrowserProof,
  clearRegistrationBrowserProof,
} from '../../src/registration/browser-proof.js';

test('registration proof binds a browser to pending credentials without exposing the email token', async (): Promise<void> => {
  const api: FastifyInstance = Fastify();
  const key: Buffer = Buffer.alloc(32, 7);
  api.post('/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    setRegistrationBrowserProof(
      reply,
      true,
      86_400_000,
      key,
      'cook@example.test',
      'salted-password-hash',
    );
    return reply.send();
  });
  api.post('/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      matches: matchesRegistrationBrowser(
        request,
        key,
        'cook@example.test',
        'salted-password-hash',
      ),
      differentEmail: matchesRegistrationBrowser(
        request,
        key,
        'other@example.test',
        'salted-password-hash',
      ),
      replacedCredentials: matchesRegistrationBrowser(
        request,
        key,
        'cook@example.test',
        'new-password-hash',
      ),
      missingSecret: matchesRegistrationBrowser(
        request,
        null,
        'cook@example.test',
        'salted-password-hash',
      ),
    });
  });
  api.post('/clear', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Set-Cookie', 'shadowcook_session=new-session; HttpOnly');
    clearRegistrationBrowserProof(reply, true);
    return reply.send();
  });
  try {
    const started: LightMyRequestResponse = await api.inject({ method: 'POST', url: '/start' });
    assert.equal(started.cookies.length, 1);
    const header: string = String(started.headers['set-cookie']);
    assert.match(header, /HttpOnly; SameSite=Lax; Max-Age=86400; Secure/);
    const cookie: string = header.split(';', 1)[0]!;
    const verified: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/verify',
      headers: { cookie },
    });
    assert.deepEqual(verified.json(), {
      matches: true,
      differentEmail: false,
      replacedCredentials: false,
      missingSecret: false,
    });
    for (const invalid of [
      '',
      'shadowcook_registration=invalid',
      `shadowcook_registration=${'0'.repeat(64)}`,
    ]) {
      const rejected: LightMyRequestResponse = await api.inject({
        method: 'POST',
        url: '/verify',
        headers: { cookie: invalid },
      });
      assert.equal(rejected.json<{ matches: boolean }>().matches, false);
    }
    const cleared: LightMyRequestResponse = await api.inject({ method: 'POST', url: '/clear' });
    assert.equal(
      cleared.cookies.find(
        (cookie: LightMyRequestResponse['cookies'][number]): boolean =>
          cookie.name === 'shadowcook_session',
      )?.value,
      'new-session',
    );
    assert.equal(
      cleared.cookies.find(
        (cookie: LightMyRequestResponse['cookies'][number]): boolean =>
          cookie.name === 'shadowcook_registration',
      )?.maxAge,
      0,
    );
  } finally {
    await api.close();
  }
});
