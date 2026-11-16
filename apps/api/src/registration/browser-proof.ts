import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const cookieName: string = 'shadowcook_registration';

function browserProof(key: Buffer, email: string, passwordHash: string): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(['registration-browser', email, passwordHash]))
    .digest('hex');
}

export function setRegistrationBrowserProof(
  reply: FastifyReply,
  secureCookies: boolean,
  lifetimeMilliseconds: number,
  key: Buffer | null = null,
  email: string = '',
  passwordHash: string = '',
): void {
  // An opaque cookie on every registration response preserves generic acknowledgements.
  const proof: string =
    key === null ? randomBytes(32).toString('hex') : browserProof(key, email, passwordHash);
  reply.removeHeader('Set-Cookie');
  reply.header(
    'Set-Cookie',
    `${cookieName}=${proof}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(lifetimeMilliseconds / 1000)}${secureCookies ? '; Secure' : ''}`,
  );
}

export function matchesRegistrationBrowser(
  request: FastifyRequest,
  key: Buffer | null,
  email: string,
  passwordHash: string,
): boolean {
  if (key === null) return false;
  const cookie: string | undefined = request.headers.cookie
    ?.split(';')
    .map((part: string): string => part.trim())
    .find((part: string): boolean => part.startsWith(`${cookieName}=`));
  const proof: string = cookie?.slice(cookieName.length + 1) ?? '';
  if (!/^[a-f0-9]{64}$/.test(proof)) return false;
  return timingSafeEqual(
    Buffer.from(proof, 'hex'),
    Buffer.from(browserProof(key, email, passwordHash), 'hex'),
  );
}

export function clearRegistrationBrowserProof(reply: FastifyReply, secureCookies: boolean): void {
  const existing: string | number | string[] | undefined = reply.getHeader('Set-Cookie');
  const cookies: string[] =
    existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  cookies.push(
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`,
  );
  reply.removeHeader('Set-Cookie');
  reply.header('Set-Cookie', cookies);
}
