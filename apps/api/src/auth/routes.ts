import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { hashPassword, minimumPasswordEntropy, verifyPassword } from './password.js';
import { completePasswordReset, createPasswordResetToken } from './password-reset.js';
import { currentSessionUser, hashSessionToken, sessionTokenFromRequest } from './session.js';
import { consumeEmailCode, normalizeEmail, requestEmailCode } from './email-code.js';
import { sendInstanceMail } from '../mail/service.js';

interface LoginBody {
  email: string;
  password: string;
}
interface ChangePasswordBody {
  currentPassword: string | null;
  newPassword: string;
}
interface LoginUserRow {
  id: string;
  password_hash: string | null;
  password_change_required: boolean;
  disabled_at: Date | null;
}
interface EmailCodeBody {
  email: string;
  code?: string;
}
interface AuthenticationSettingsRow {
  login_mode: 'PASSWORD_ONLY' | 'EMAIL_CODE_ONLY' | 'PASSWORD_OR_EMAIL_CODE';
}
interface PasswordResetBody {
  email?: string;
  token?: string;
  newPassword?: string;
}

const sessionCookieName: string = 'shadowcook_session';
const sessionLifetimeMilliseconds: number = 1000 * 60 * 60 * 24 * 14;

export function registerAuthenticationRoutes(
  api: FastifyInstance,
  pool: Pool,
  secureCookies: boolean,
  instanceSecretKey: Buffer | null,
  publicWebOrigin: string,
): void {
  api.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestPath: string = request.url.split('?', 1)[0];
    if (
      requestPath === '/health' ||
      requestPath === '/auth/login' ||
      requestPath === '/auth/change-password' ||
      requestPath === '/auth/password-reset/request' ||
      requestPath === '/auth/password-reset/complete' ||
      requestPath === '/auth/logout' ||
      requestPath === '/auth/session' ||
      requestPath === '/auth/email-code/request' ||
      requestPath === '/auth/email-code/verify' ||
      requestPath === '/auth/authentication-methods' ||
      requestPath === '/auth/password-requirements' ||
      requestPath === '/registration' ||
      requestPath === '/registration/config' ||
      requestPath === '/registration/resend-verification' ||
      requestPath === '/registration/verify' ||
      requestPath.startsWith('/invitations/') ||
      requestPath.startsWith('/user-invitations/')
    )
      return;
    const user = await currentSessionUser(pool, request);
    if (user?.password_change_required === true) {
      return sendError(
        reply,
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'A password change is required before continuing.',
      );
    }
  });

  api.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body: LoginBody | null = parseLoginBody(request.body);
    if (body === null) {
      return sendError(reply, 400, 'INVALID_LOGIN_BODY', 'Email and password are required.');
    }
    const settings = await authenticationSettings(pool);
    if (settings.login_mode === 'EMAIL_CODE_ONLY')
      return sendError(reply, 403, 'PASSWORD_LOGIN_DISABLED', 'Password login is disabled.');
    const result = await pool.query<LoginUserRow>(
      'SELECT id, password_hash, password_change_required, disabled_at FROM user_account WHERE email = $1 AND deleted_at IS NULL',
      [body.email.trim().toLowerCase()],
    );
    const user: LoginUserRow | undefined = result.rows[0];
    if (
      user === undefined ||
      user.disabled_at !== null ||
      user.password_hash === null ||
      !(await verifyPassword(body.password, user.password_hash))
    ) {
      return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    await createSession(pool, reply, user.id, secureCookies);
    return reply.send({
      hasPassword: user.password_hash !== null,
      passwordChangeRequired: user.password_change_required,
    });
  });

  api.get('/auth/password-requirements', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      minimumPasswordEntropy: await minimumPasswordEntropy(pool),
    });
  });

  api.get('/auth/authentication-methods', async (_request: FastifyRequest, reply: FastifyReply) => {
    const settings = await authenticationSettings(pool);
    return reply.send({
      password: settings.login_mode !== 'EMAIL_CODE_ONLY',
      emailCode: settings.login_mode !== 'PASSWORD_ONLY',
    });
  });

  api.post('/auth/email-code/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseEmailCodeBody(request.body, false);
    const email = body === null ? null : normalizeEmail(body.email);
    const settings = await authenticationSettings(pool);
    if (settings.login_mode === 'PASSWORD_ONLY') return reply.code(204).send();
    if (email === null) return reply.code(204).send();
    const user = await pool.query<{ id: string; disabled_at: Date | null }>(
      'SELECT id, disabled_at FROM user_account WHERE email = $1 AND deleted_at IS NULL',
      [email],
    );
    if (user.rows[0] === undefined || user.rows[0].disabled_at !== null)
      return reply.code(204).send();
    const code = await requestEmailCode(pool, email, 'LOGIN', request.ip ?? null);
    if (code !== null) {
      try {
        await sendInstanceMail(
          pool,
          instanceSecretKey,
          email,
          'Your Shadowcook sign-in code',
          `Your Shadowcook sign-in code is ${code}. It expires in 10 minutes.`,
        );
      } catch (error: unknown) {
        request.log.warn({ error }, 'Email code delivery failed');
      }
    }
    return reply.code(204).send();
  });
  api.post('/auth/email-code/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseEmailCodeBody(request.body, true);
    const email = body === null ? null : normalizeEmail(body.email);
    if (email === null || body === null || body.code === undefined)
      return sendError(reply, 400, 'INVALID_EMAIL_CODE', 'The email code request is invalid.');
    const settings = await authenticationSettings(pool);
    if (settings.login_mode === 'PASSWORD_ONLY')
      return sendError(reply, 403, 'EMAIL_CODE_LOGIN_DISABLED', 'Email-code login is disabled.');
    const consumed = await consumeEmailCode(pool, email, 'LOGIN', body.code);
    const user = await pool.query<LoginUserRow>(
      'SELECT id, password_hash, password_change_required, disabled_at FROM user_account WHERE email = $1 AND deleted_at IS NULL',
      [email],
    );
    if (consumed === null || user.rows[0] === undefined || user.rows[0].disabled_at !== null)
      return sendError(reply, 401, 'INVALID_EMAIL_CODE', 'The code is invalid or expired.');
    await createSession(pool, reply, user.rows[0].id, secureCookies);
    return reply.send({
      hasPassword: user.rows[0].password_hash !== null,
      passwordChangeRequired: user.rows[0].password_change_required,
    });
  });

  api.post('/auth/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body: ChangePasswordBody | null = parseChangePasswordBody(request.body);
    const token: string | null = sessionTokenFromRequest(request);
    if (body === null) {
      return sendError(reply, 400, 'INVALID_PASSWORD', 'A new password is required.');
    }
    if (token === null) {
      return sendError(reply, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    }
    const user = await currentSessionUser(pool, request);
    if (
      user === null ||
      (user.password_hash !== null &&
        (body.currentPassword === null ||
          !(await verifyPassword(body.currentPassword, user.password_hash))))
    ) {
      return sendError(reply, 401, 'AUTHENTICATION_FAILED', 'Authentication failed.');
    }
    try {
      const passwordHash: string = await hashPassword(
        body.newPassword,
        await minimumPasswordEntropy(pool),
      );
      await pool.query(
        'UPDATE user_account SET password_hash = $1, password_change_required = false, password_changed_at = now(), updated_at = now() WHERE id = $2',
        [passwordHash, user.id],
      );
    } catch (error: unknown) {
      return sendError(
        reply,
        400,
        'INVALID_PASSWORD',
        error instanceof Error ? error.message : 'Invalid password.',
      );
    }
    return reply.code(204).send();
  });

  api.post('/auth/password-reset/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const body: PasswordResetBody | null = parsePasswordResetBody(request.body);
    const email: string | null = body?.email === undefined ? null : normalizeEmail(body.email);
    if (email === null) return reply.code(204).send();
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM user_account WHERE email = $1 AND disabled_at IS NULL AND deleted_at IS NULL',
      [email],
    );
    const user = result.rows[0];
    if (user === undefined) return reply.code(204).send();
    const recentReset = await pool.query<{ requested: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM password_reset_token
        WHERE user_account_id = $1 AND created_at > now() - interval '10 minutes'
      ) AS requested`,
      [user.id],
    );
    if (recentReset.rows[0]?.requested === true) return reply.code(204).send();
    const token: string = await createPasswordResetToken(pool, user.id, false);
    try {
      await sendInstanceMail(
        pool,
        instanceSecretKey,
        email,
        'Reset your Shadowcook password',
        `Use this link to reset your Shadowcook password: ${publicWebOrigin}/password-reset/${token}. The link expires in one hour.`,
      );
    } catch (error: unknown) {
      request.log.warn({ error }, 'Password-reset email delivery failed');
    }
    return reply.code(204).send();
  });

  api.post(
    '/auth/password-reset/complete',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body: PasswordResetBody | null = parsePasswordResetBody(request.body);
      if (
        body?.token === undefined ||
        body.token.length === 0 ||
        body.newPassword === undefined ||
        body.newPassword.length === 0
      )
        return sendError(reply, 400, 'INVALID_PASSWORD_RESET', 'The password reset is invalid.');
      try {
        const completed: boolean = await completePasswordReset(
          pool,
          body.token,
          body.newPassword,
          await minimumPasswordEntropy(pool),
        );
        if (!completed)
          return sendError(reply, 400, 'INVALID_PASSWORD_RESET', 'The password reset is invalid.');
        return reply.code(204).send();
      } catch (error: unknown) {
        return sendError(
          reply,
          400,
          'INVALID_PASSWORD',
          error instanceof Error ? error.message : 'Invalid password.',
        );
      }
    },
  );

  api.get('/auth/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentSessionUser(pool, request);
    if (user === null)
      return sendError(reply, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    return reply.send({
      email: user.email,
      passwordChangeRequired: user.password_change_required,
      hasPassword: user.password_hash !== null,
    });
  });

  api.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token: string | null = sessionTokenFromRequest(request);
    let revokedSessions: number = 0;
    if (token !== null) {
      const result = await pool.query(
        'UPDATE user_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [hashSessionToken(token)],
      );
      revokedSessions = result.rowCount ?? 0;
    }
    request.log.info(
      { hadSessionToken: token !== null, revokedSessions },
      'Session logout processed',
    );
    clearSessionCookie(reply, secureCookies);
    return reply.code(204).send();
  });
}

function parseLoginBody(body: unknown): LoginBody | null {
  if (!isRecord(body) || typeof body.email !== 'string' || typeof body.password !== 'string')
    return null;
  return { email: body.email, password: body.password };
}

function parseChangePasswordBody(body: unknown): ChangePasswordBody | null {
  if (
    !isRecord(body) ||
    (typeof body.currentPassword !== 'string' &&
      body.currentPassword !== null &&
      body.currentPassword !== undefined) ||
    typeof body.newPassword !== 'string'
  )
    return null;
  return {
    currentPassword: typeof body.currentPassword === 'string' ? body.currentPassword : null,
    newPassword: body.newPassword,
  };
}
function parseEmailCodeBody(body: unknown, requireCode: boolean): EmailCodeBody | null {
  if (
    !isRecord(body) ||
    typeof body.email !== 'string' ||
    (requireCode && typeof body.code !== 'string')
  )
    return null;
  return { email: body.email, code: typeof body.code === 'string' ? body.code : undefined };
}
function parsePasswordResetBody(body: unknown): PasswordResetBody | null {
  if (!isRecord(body)) return null;
  if (
    (body.email !== undefined && typeof body.email !== 'string') ||
    (body.token !== undefined && typeof body.token !== 'string') ||
    (body.newPassword !== undefined && typeof body.newPassword !== 'string')
  )
    return null;
  return {
    email: typeof body.email === 'string' ? body.email : undefined,
    token: typeof body.token === 'string' ? body.token : undefined,
    newPassword: typeof body.newPassword === 'string' ? body.newPassword : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function createSession(
  pool: Pool,
  reply: FastifyReply,
  userId: string,
  secureCookies: boolean,
): Promise<void> {
  const token: string = randomBytes(32).toString('base64url');
  const expiresAt: Date = new Date(Date.now() + sessionLifetimeMilliseconds);
  await pool.query(
    'INSERT INTO user_session (user_account_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashSessionToken(token), expiresAt],
  );
  await pool.query(
    'UPDATE user_account SET last_login_at = now(), updated_at = now() WHERE id = $1',
    [userId],
  );
  setSessionCookie(reply, token, expiresAt, secureCookies);
}
function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secureCookies: boolean,
): void {
  const secureAttribute: string = secureCookies ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${sessionCookieName}=${token}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Expires=${expiresAt.toUTCString()}`,
  );
}
function clearSessionCookie(reply: FastifyReply, secureCookies: boolean): void {
  const secureAttribute: string = secureCookies ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${sessionCookieName}=; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=0`,
  );
}
async function authenticationSettings(pool: Pool): Promise<AuthenticationSettingsRow> {
  const result = await pool.query<AuthenticationSettingsRow>(
    'SELECT login_mode FROM instance_authentication_settings WHERE singleton = true',
  );
  return result.rows[0] ?? { login_mode: 'PASSWORD_OR_EMAIL_CODE' };
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  error: string,
): FastifyReply {
  return reply.code(statusCode).send({ code, error });
}
