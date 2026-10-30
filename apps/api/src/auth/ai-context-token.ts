import type { FastifyRequest } from 'fastify';

export function aiContextTokenFromRequest(
  request: Pick<FastifyRequest, 'headers' | 'url'>,
): string | null {
  const queryIndex: number = request.url.indexOf('?');
  const parameters: URLSearchParams = new URLSearchParams(
    queryIndex === -1 ? '' : request.url.slice(queryIndex + 1),
  );
  const queryTokens: string[] = parameters.getAll('access_token');
  const authorization: string | undefined = request.headers.authorization;

  if (authorization !== undefined) {
    if (queryTokens.length !== 0) return null;
    const match: RegExpMatchArray | null = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
    return match?.[1] ?? null;
  }

  const token: string | undefined = queryTokens[0];
  if (queryTokens.length !== 1 || token === undefined || !/^[A-Za-z0-9_-]+$/.test(token))
    return null;
  return token;
}
