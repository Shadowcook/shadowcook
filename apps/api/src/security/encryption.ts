import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const initializationVectorLength: number = 12;
const authenticationTagLength: number = 16;

export function encryptSecret(value: string, key: Buffer): Buffer {
  const initializationVector: Buffer = randomBytes(initializationVectorLength);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const encrypted: Buffer = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authenticationTag: Buffer = cipher.getAuthTag();
  return Buffer.concat([initializationVector, authenticationTag, encrypted]);
}

export function decryptSecret(value: Buffer, key: Buffer): string {
  if (value.length <= initializationVectorLength + authenticationTagLength) throw new Error('Stored secret has an invalid format.');
  const initializationVector: Buffer = value.subarray(0, initializationVectorLength);
  const authenticationTag: Buffer = value.subarray(initializationVectorLength, initializationVectorLength + authenticationTagLength);
  const encrypted: Buffer = value.subarray(initializationVectorLength + authenticationTagLength);
  const decipher = createDecipheriv('aes-256-gcm', key, initializationVector);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
