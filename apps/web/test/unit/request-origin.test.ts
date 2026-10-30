import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedRequestOrigin } from '../../src/lib/server/request-origin.ts';

const webOrigin: string = 'https://cookbook.example.test';
const inspectorOrigin: string = 'http://127.0.0.1:6274';

function allowedRequest(
  pathname: string,
  method: string,
  contentType: string | null,
  origin: string | null,
): boolean {
  const url: URL = new URL(pathname, webOrigin);
  const headers: Headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (origin !== null) headers.set('origin', origin);
  return isAllowedRequestOrigin(new Request(url, { method, headers }), url);
}

test('OAuth token form POSTs accept an external or absent Origin', (): void => {
  for (const origin of [inspectorOrigin, null, 'null']) {
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'Application/X-Www-Form-Urlencoded; charset=UTF-8',
    ]) {
      assert.equal(allowedRequest('/api/oauth/token', 'POST', contentType, origin), true);
    }
  }
});

test('the OAuth exception requires the exact token path, POST method, and form encoding', (): void => {
  const paths: string[] = [
    '/login',
    '/api/auth/logout',
    '/api/oauth/token/extra',
    '/api/oauth/token/',
  ];
  for (const pathname of paths) {
    assert.equal(
      allowedRequest(pathname, 'POST', 'application/x-www-form-urlencoded', inspectorOrigin),
      false,
    );
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(
      allowedRequest(
        '/api/oauth/token',
        method,
        'application/x-www-form-urlencoded',
        inspectorOrigin,
      ),
      false,
    );
  }
  for (const contentType of ['multipart/form-data; boundary=test', 'text/plain', null]) {
    assert.equal(allowedRequest('/api/oauth/token', 'POST', contentType, inspectorOrigin), false);
  }
});

test('ordinary form requests require the website Origin', (): void => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=test',
      'text/plain; charset=UTF-8',
      null,
    ]) {
      assert.equal(allowedRequest('/api/auth/logout', method, contentType, webOrigin), true);
      assert.equal(allowedRequest('/api/auth/logout', method, contentType, inspectorOrigin), false);
      assert.equal(allowedRequest('/api/auth/logout', method, contentType, null), false);
    }
  }
});

test('safe methods and non-form JSON requests retain their previous Origin behavior', (): void => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(allowedRequest('/api/auth/session', method, null, inspectorOrigin), true);
  }
  assert.equal(allowedRequest('/api/mcp', 'POST', 'application/json', inspectorOrigin), true);
  assert.equal(allowedRequest('/api/mcp', 'POST', 'application/json', null), true);
});
