import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedOAuthRedirectUri } from '../../src/auth/oauth-redirect-uri.js';

test('OAuth callbacks accept HTTPS and literal IPv4 and IPv6 HTTP loopback addresses', (): void => {
  const allowedUris: string[] = [
    'https://client.example.test/oauth/callback',
    'https://client.example.test:8443/oauth/callback?client=inspector',
    'http://127.0.0.1:6274/oauth/callback',
    'http://127.0.0.1:49152/oauth/callback?client=inspector',
    'http://[::1]:6274/oauth/callback',
  ];
  for (const uri of allowedUris) assert.equal(isAllowedOAuthRedirectUri(uri), true, uri);
});

test('OAuth callbacks reject non-loopback HTTP, misleading hosts, credentials, and fragments', (): void => {
  const rejectedUris: string[] = [
    'http://client.example.test/oauth/callback',
    'http://192.168.1.2:6274/oauth/callback',
    'http://0.0.0.0:6274/oauth/callback',
    'http://[::]:6274/oauth/callback',
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1.example.test:6274/oauth/callback',
    'http://[::ffff:127.0.0.1]:6274/oauth/callback',
    'http://127.0.0.1@client.example.test/oauth/callback',
    'http://user:password@127.0.0.1:6274/oauth/callback',
    'https://user:password@client.example.test/oauth/callback',
    'https://client.example.test/oauth/callback#fragment',
    'http://127.0.0.1:6274/oauth/callback#',
    '/oauth/callback',
    'javascript:alert(1)',
    'file:///oauth/callback',
    'not a URL',
  ];
  for (const uri of rejectedUris) assert.equal(isAllowedOAuthRedirectUri(uri), false, uri);
});
