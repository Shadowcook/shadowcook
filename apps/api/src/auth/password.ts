import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import type { ZxcvbnResult } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as germanDictionary } from '@zxcvbn-ts/language-de';
import { dictionary as englishDictionary, translations } from '@zxcvbn-ts/language-en';

const scrypt: (password: string, salt: Buffer, keyLength: number) => Promise<Buffer> =
  promisify(scryptCallback);
const saltLength: number = 16;
const keyLength: number = 32;
export const defaultMinimumPasswordEntropy: number = 60;
const maximumPasswordEntropy: number = 256;
const passwordAnalysisMaximumLength: number = 64;
const logarithmBase2Of10: number = Math.log2(10);
const passwordStrength: ZxcvbnFactory = new ZxcvbnFactory({
  dictionary: { ...commonDictionary, ...englishDictionary, ...germanDictionary },
  graphs: adjacencyGraphs,
  translations,
});

export function generateBootstrapPassword(): string {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

export async function hashPassword(
  password: string,
  minimumEntropy: number = defaultMinimumPasswordEntropy,
): Promise<string> {
  validatePassword(password, minimumEntropy);
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

export async function minimumPasswordEntropy(pool: Pool): Promise<number> {
  const result = await pool.query<{ minimum_password_entropy: number }>(
    'SELECT minimum_password_entropy FROM instance_authentication_settings WHERE singleton = true',
  );
  return result.rows[0]?.minimum_password_entropy ?? defaultMinimumPasswordEntropy;
}

export function estimatePasswordEntropy(password: string): number {
  const analyzedPassword: string = password.slice(0, passwordAnalysisMaximumLength);
  const result: ZxcvbnResult = passwordStrength.check(analyzedPassword);
  if (result.sequence.every((match): boolean => match.pattern === 'bruteforce'))
    return estimateRandomPasswordEntropy(analyzedPassword);
  return result.guessesLog10 * logarithmBase2Of10;
}

function estimateRandomPasswordEntropy(password: string): number {
  const characters: string[] = Array.from(password);
  if (characters.length === 0) return 0;
  let characterPoolSize: number = 0;
  if (characters.some((character: string): boolean => /[a-z]/.test(character)))
    characterPoolSize += 26;
  if (characters.some((character: string): boolean => /[A-Z]/.test(character)))
    characterPoolSize += 26;
  if (characters.some((character: string): boolean => /[0-9]/.test(character)))
    characterPoolSize += 10;
  if (characters.some((character: string): boolean => /\s/.test(character))) characterPoolSize += 1;
  if (characters.some((character: string): boolean => !/[A-Za-z0-9\s]/.test(character)))
    characterPoolSize += 33;
  return characters.length * Math.log2(characterPoolSize);
}

export function validatePassword(
  password: string,
  minimumEntropy: number = defaultMinimumPasswordEntropy,
): void {
  if (process.env.NODE_ENV === 'development') return;
  if (
    !Number.isSafeInteger(minimumEntropy) ||
    minimumEntropy < 1 ||
    minimumEntropy > maximumPasswordEntropy
  ) {
    throw new Error('Password minimum entropy must be an integer between 1 and 256 bits.');
  }
  if (password.length > 1024) {
    throw new Error('Password must not exceed 1024 characters.');
  }
  if (estimatePasswordEntropy(password) < minimumEntropy) {
    throw new Error(`Password must provide at least ${minimumEntropy} bits of estimated entropy.`);
  }
}
