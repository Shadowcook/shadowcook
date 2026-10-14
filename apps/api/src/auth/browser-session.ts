import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { hashSessionToken } from './session.js';

export interface BrowserSession {
  token: string;
  expiresAt: Date;
}

const sessionCookieName: string = 'shadowcook_session';
const sessionLifetimeMilliseconds: number = 1000 * 60 * 60 * 24 * 14;

export async function issueSession(
  database: Pool | PoolClient,
  userId: string,
): Promise<BrowserSession> {
  const session: BrowserSession = {
    token: randomBytes(32).toString('base64url'),
    expiresAt: new Date(Date.now() + sessionLifetimeMilliseconds),
  };
  await database.query(
    'INSERT INTO user_session (user_account_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashSessionToken(session.token), session.expiresAt],
  );
  await database.query(
    'UPDATE user_account SET last_login_at = now(), updated_at = now() WHERE id = $1',
    [userId],
  );
  return session;
}

export async function createSession(
  database: Pool | PoolClient,
  reply: FastifyReply,
  userId: string,
  secureCookies: boolean,
): Promise<void> {
  const session: BrowserSession = await issueSession(database, userId);
  setSessionCookie(reply, session, secureCookies);
}

export function setSessionCookie(
  reply: FastifyReply,
  session: BrowserSession,
  secureCookies: boolean,
): void {
  const secureAttribute: string = secureCookies ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${sessionCookieName}=${session.token}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Expires=${session.expiresAt.toUTCString()}`,
  );
}

export function clearSessionCookie(reply: FastifyReply, secureCookies: boolean): void {
  const secureAttribute: string = secureCookies ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${sessionCookieName}=; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=0`,
  );
}
