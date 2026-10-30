import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { normalizeEmail } from '../auth/email-code.js';
import {
  currentSessionUser,
  sessionTokenFromRequest,
  type AuthenticatedSessionUser,
} from '../auth/session.js';
import {
  emailChangeStatus,
  sendEmailChange,
  verifyEmailChange,
  type EmailChangeStatus,
} from './email-change.js';
import {
  EmailChangeError,
  loadEmailChangeVerification,
  type StoredEmailChangeVerification,
} from './email-change-verification.js';

export function registerEmailChangeRoutes(
  api: FastifyInstance,
  pool: Pool,
  instanceSecretKey: Buffer | null,
  publicWebOrigin: string,
): void {
  api.get('/account/email-change', async (request: FastifyRequest, reply: FastifyReply) => {
    const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
    if (user === null) return failure(reply, 401, 'AUTHENTICATION_REQUIRED');
    try {
      return reply.send(await emailChangeStatus(pool, user.id));
    } catch (error: unknown) {
      if (error instanceof EmailChangeError) return failure(reply, error.status, error.code);
      throw error;
    }
  });

  async function send(
    request: FastifyRequest,
    reply: FastifyReply,
    resend: boolean,
  ): Promise<FastifyReply> {
    const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
    if (user === null) return failure(reply, 401, 'AUTHENTICATION_REQUIRED');
    const body: unknown = request.body;
    const email: string | null =
      typeof body === 'object' &&
      body !== null &&
      'email' in body &&
      typeof body.email === 'string' &&
      body.email.trim().length <= 254
        ? normalizeEmail(body.email)
        : null;
    if (!resend && email === null) return failure(reply, 400, 'INVALID_EMAIL');
    try {
      const status: EmailChangeStatus = await sendEmailChange(
        pool,
        user.id,
        resend ? null : email,
        instanceSecretKey,
        publicWebOrigin,
      );
      return reply.code(202).send(status);
    } catch (error: unknown) {
      if (!(error instanceof EmailChangeError)) throw error;
      if (error.retryAfterSeconds !== null)
        reply.header('Retry-After', String(error.retryAfterSeconds));
      return failure(reply, error.status, error.code);
    }
  }
  api.post('/account/email-change', (request: FastifyRequest, reply: FastifyReply) =>
    send(request, reply, false),
  );
  api.post('/account/email-change/resend', (request: FastifyRequest, reply: FastifyReply) =>
    send(request, reply, true),
  );
  api.post(
    '/account/email-change/verification',
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const token: string | null = parseVerificationToken(request.body);
      if (token === null) return failure(reply, 400, 'INVALID_EMAIL_CHANGE_TOKEN');
      try {
        const verification: StoredEmailChangeVerification = await loadEmailChangeVerification(
          pool,
          token,
          sessionTokenFromRequest(request),
        );
        return reply.send({
          currentEmail: verification.currentEmail,
          email: verification.email,
          expiresAt: verification.expiresAt,
          reauthenticationRequired: verification.reauthenticationRequired,
        });
      } catch (error: unknown) {
        if (error instanceof EmailChangeError) return failure(reply, error.status, error.code);
        throw error;
      }
    },
  );
  api.post(
    '/account/email-change/verify',
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const token: string | null = parseVerificationToken(request.body);
      if (token === null) return failure(reply, 400, 'INVALID_EMAIL_CHANGE_TOKEN');
      try {
        await verifyEmailChange(pool, token, sessionTokenFromRequest(request));
        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof EmailChangeError) return failure(reply, error.status, error.code);
        throw error;
      }
    },
  );
}

function parseVerificationToken(body: unknown): string | null {
  return typeof body === 'object' &&
    body !== null &&
    'token' in body &&
    typeof body.token === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(body.token)
    ? body.token
    : null;
}

function failure(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ code, error: code });
}
