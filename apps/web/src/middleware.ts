import type { MiddlewareHandler } from 'astro';

const apiPrefix: string = '/api';
const defaultApiOrigin: string = 'http://localhost:3000';

export const onRequest: MiddlewareHandler = async (context, next): Promise<Response> => {
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  if (isTenantManagementPath(context.url.pathname)) {
    let sessionIsValid: boolean = false;
    try {
      const sessionUrl: URL = new URL('/auth/session', apiOrigin);
      const session: Response = await fetch(sessionUrl, {
        headers: { cookie: context.request.headers.get('cookie') ?? '' },
      });
      sessionIsValid = session.ok;
    } catch (_error: unknown) {
      sessionIsValid = false;
    }
    if (!sessionIsValid)
      return Response.json(
        { code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' },
        { status: 401 },
      );
  }
  if (!context.url.pathname.startsWith(`${apiPrefix}/`)) return next();
  const apiPath: string = context.url.pathname.slice(apiPrefix.length);
  const apiUrl: URL = new URL(`${apiPath}${context.url.search}`, apiOrigin);
  return fetch(apiUrl, { method: context.request.method, headers: context.request.headers });
};

function isTenantManagementPath(pathname: string): boolean {
  const segments: string[] = pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  if (segments.length < 2) return false;
  if (segments[1] === 'drafts' || segments[1] === 'categories' || segments[1] === 'manage')
    return true;
  return (
    segments[1] === 'recipes' &&
    (segments[2] === 'new' || (segments.length === 4 && segments[3] === 'edit'))
  );
}
