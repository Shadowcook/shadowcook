import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { hashEmailCode, normalizeEmail } from '../../src/auth/email-code.js';
import { hashSessionToken, sessionTokenFromRequest } from '../../src/auth/session.js';
import { decryptSecret, encryptSecret } from '../../src/security/encryption.js';

test('email normalization trims and lowercases valid email addresses', (): void => {
  assert.equal(normalizeEmail('  Owner@Example.Test '), 'owner@example.test');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail('user@example'), null);
});

test('token hashes are deterministic SHA-256 values', (): void => {
  assert.deepEqual(hashSessionToken('session-token'), hashSessionToken('session-token'));
  assert.notDeepEqual(hashSessionToken('session-token'), hashSessionToken('other-token'));
  assert.deepEqual(hashEmailCode('123456'), hashEmailCode('123456'));
});

test('session cookie parsing accepts only the session cookie', (): void => {
  const request = { headers: { cookie: 'other=value; shadowcook_session=token-value; x=y' } };
  assert.equal(sessionTokenFromRequest(request as never), 'token-value');
  assert.equal(sessionTokenFromRequest({ headers: {} } as never), null);
});

test('encrypted secrets round trip and reject the wrong key', (): void => {
  const key: Buffer = randomBytes(32);
  const encrypted: Buffer = encryptSecret('smtp-password', key);

  assert.notEqual(encrypted.toString('utf8'), 'smtp-password');
  assert.equal(decryptSecret(encrypted, key), 'smtp-password');
  assert.throws((): string => decryptSecret(encrypted, randomBytes(32)));
  assert.throws((): string => decryptSecret(Buffer.from('short'), key), /invalid format/);
});
