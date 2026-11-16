import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt: (password: string, salt: Buffer, keyLength: number) => Promise<Buffer> =
  promisify(scryptCallback);
const saltLength: number = 16;
const keyLength: number = 32;

// Cryptographic encoding only. Callers enforce the password policy for their workflow.
export async function createPasswordHash(password: string): Promise<string> {
  const salt: Buffer = randomBytes(saltLength);
  const derivedKey: Buffer = await scrypt(password, salt, keyLength);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts: string[] = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const salt: Buffer = Buffer.from(parts[1], 'base64url');
  const expected: Buffer = Buffer.from(parts[2], 'base64url');
  if (salt.length !== saltLength || expected.length !== keyLength) {
    return false;
  }

  const actual: Buffer = await scrypt(password, salt, keyLength);
  return timingSafeEqual(actual, expected);
}
