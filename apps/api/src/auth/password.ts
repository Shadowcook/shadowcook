import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt: (password: string, salt: Buffer, keyLength: number) => Promise<Buffer> = promisify(scryptCallback);
const saltLength: number = 16;
const keyLength: number = 32;

export function generateBootstrapPassword(): string {
  return randomBytes(24).toString('base64url');
}

export async function hashPassword(password: string, minimumLength: number = 12): Promise<string> {
  validatePassword(password, minimumLength);
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

export function validatePassword(password: string, minimumLength: number = 12): void {
  if (!Number.isSafeInteger(minimumLength) || minimumLength < 1) {
    throw new Error('Password minimum length must be a positive integer.');
  }
  if (password.length < minimumLength) {
    throw new Error(`Password must contain at least ${minimumLength} characters.`);
  }
  if (password.length > 1024) {
    throw new Error('Password must not exceed 1024 characters.');
  }
}
