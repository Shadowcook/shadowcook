import type { FastifyReply } from 'fastify';
export function safetyError(statusCode: number, code: string): never {
  throw Object.assign(new Error('Administrative safety check failed.'), { statusCode, code });
}
export function sendSafetyError(reply: FastifyReply, error: unknown): unknown {
  const value: { statusCode?: number; code?: string } = error as {
    statusCode?: number;
    code?: string;
  };
  if (
    [400, 404, 409, 429].includes(value.statusCode ?? 0) &&
    /^(INVALID_|LAST_|OWNED_|EMAIL_|RECOVERY_|STALE_|RESOURCE_|REPORT_|MEDIA_)/.test(
      value.code ?? '',
    )
  )
    return reply
      .code(value.statusCode!)
      .send({ code: value.code, error: 'Administrative safety check failed.' });
  throw error;
}
