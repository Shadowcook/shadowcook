import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReauthenticationRequest,
  reauthenticationLoginUrl,
} from '../../src/lib/login-navigation.ts';

test('email-change reauthentication preserves the complete confirmation path through login', (): void => {
  const path: string = '/settings/email/verify/Abc_123-def';
  const login: URL = new URL(reauthenticationLoginUrl(path), 'https://cookbook.example.test');
  assert.equal(login.pathname, '/login');
  assert.equal(login.searchParams.get('next'), path);
  assert.equal(isReauthenticationRequest(login.pathname, login.search), true);
});

test('only an explicit login request forces authentication despite an existing session', (): void => {
  assert.equal(isReauthenticationRequest('/login', '?reauth=1'), true);
  assert.equal(isReauthenticationRequest('/login', '?next=%2Fsettings%2Femail'), false);
  assert.equal(isReauthenticationRequest('/login', '?reauth=0'), false);
  assert.equal(isReauthenticationRequest('/settings/email', '?reauth=1'), false);
});
