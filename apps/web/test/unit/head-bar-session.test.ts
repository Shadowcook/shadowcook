import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { loadHeadBarSession, type HeadBarSession } from '../../src/lib/server/head-bar-session.ts';

test('header hydration projects only the displayed identity and navigation access', async (context: TestContext): Promise<void> => {
  context.mock.method(
    globalThis,
    'fetch',
    async (url: URL, options: RequestInit): Promise<Response> => {
      if (url.pathname === '/admin/tenants') return Response.json({ tenants: [] });
      if (new Headers(options.headers).get('cookie') !== 'shadowcook_session=synthetic') {
        return new Response(null, { status: 401 });
      }
      return Response.json({
        email: 'member@example.test',
        displayName: 'Synthetic Member',
        principalId: 'internal-test-id',
        token: 'synthetic-secret',
        hasPassword: true,
      });
    },
  );
  const member: HeadBarSession = await loadHeadBarSession('shadowcook_session=synthetic');
  assert.deepEqual(member, {
    authenticated: true,
    email: 'member@example.test',
    displayName: 'Synthetic Member',
    canAccessAdministration: true,
  });
  const anonymous: HeadBarSession = await loadHeadBarSession(null);
  assert.deepEqual(anonymous, {
    authenticated: false,
    email: '',
    displayName: '',
    canAccessAdministration: false,
  });
});
