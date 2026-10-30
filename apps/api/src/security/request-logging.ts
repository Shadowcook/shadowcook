import type { FastifyReply, FastifyRequest } from 'fastify';

interface LoggedRequest {
  [key: string]: unknown;
  method: string;
  url: string;
  version: string | undefined;
  host: string;
  remoteAddress: string;
  remotePort: number | undefined;
}

export function serializeRequestForLog(request: FastifyRequest): LoggedRequest {
  const version: string | string[] | undefined = request.headers['accept-version'];
  return {
    method: request.method,
    url: redactRequestUrl(request.url),
    version: Array.isArray(version) ? version.join(',') : version,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

export function replyWithNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const message: string = `Route ${request.method}:${redactRequestUrl(request.url)} not found`;
  request.log.info(message);
  return reply.code(404).send({ message, error: 'Not Found', statusCode: 404 });
}

function redactRequestUrl(url: string): string {
  const queryIndex: number = url.indexOf('?');
  const pathname: string = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const safePathname: string = pathname.replace(
    /^\/ai-context\/(?!reader(?:\/|$))[^/]+/,
    '/ai-context/[REDACTED]',
  );
  if (queryIndex === -1) return safePathname;

  const parameters: URLSearchParams = new URLSearchParams(url.slice(queryIndex + 1));
  if (!parameters.has('access_token') && !parameters.has('shareToken'))
    return `${safePathname}${url.slice(queryIndex)}`;
  for (const key of ['access_token', 'shareToken']) {
    if (parameters.has(key)) parameters.set(key, '[REDACTED]');
  }
  return `${safePathname}?${parameters.toString()}`;
}
