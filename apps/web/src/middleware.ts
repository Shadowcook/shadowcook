import type { MiddlewareHandler } from 'astro';

const apiPrefix: string = '/api';
const defaultApiOrigin: string = 'http://localhost:3000';

export const onRequest: MiddlewareHandler = async (context, next): Promise<Response> => {
  if (!context.url.pathname.startsWith(`${apiPrefix}/`)) return next();
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  const apiPath: string = context.url.pathname.slice(apiPrefix.length);
  const apiUrl: URL = new URL(`${apiPath}${context.url.search}`, apiOrigin);
  return fetch(apiUrl, { method: context.request.method, headers: context.request.headers });
};
