import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimatePasswordEntropy,
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../../src/auth/password.js';

test('password hashes verify only the original password', async (): Promise<void> => {
  const password: string = 'eR7!vQ2#nL9@xC4$kM8%pT6&zA1*';
  const passwordHash: string = await hashPassword(password, 60);

  assert.match(passwordHash, /^scrypt\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword(`${password}x`, passwordHash), false);
});

test('malformed password hashes do not verify', async (): Promise<void> => {
  assert.equal(await verifyPassword('any password', 'not-a-password-hash'), false);
  assert.equal(await verifyPassword('any password', 'scrypt$short$short'), false);
});

test('password validation rejects invalid thresholds and low-entropy passwords', (): void => {
  assert.throws((): void => validatePassword('password', 0), /integer between 1 and 256 bits/);
  assert.throws((): void => validatePassword('password', 60), /at least 60 bits/);
});

test('random-looking passwords estimate more entropy than common passwords', (): void => {
  assert.ok(estimatePasswordEntropy('eR7!vQ2#nL9@xC4$kM8%pT6&zA1*') > 60);
  assert.ok(estimatePasswordEntropy('password') < 60);
});
