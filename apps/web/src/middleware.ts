import type { MiddlewareHandler } from 'astro';

const apiPrefix: string = '/api';
const defaultApiOrigin: string = 'http://localhost:3000';

export const onRequest: MiddlewareHandler = async (context, next): Promise<Response> => {
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  if (requiresAuthentication(context.url.pathname)) {
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
    if (!sessionIsValid) return Response.redirect(loginUrl(context.url), 302);
  }
  if (!context.url.pathname.startsWith(`${apiPrefix}/`)) return next();
  const apiPath: string = context.url.pathname.slice(apiPrefix.length);
  const apiUrl: URL = new URL(`${apiPath}${context.url.search}`, apiOrigin);
  const requestBody: ArrayBuffer | undefined =
    context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : await context.request.arrayBuffer();
  return fetch(apiUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: requestBody,
  });
};

function requiresAuthentication(pathname: string): boolean {
  return isAdministrationPath(pathname) || isTenantManagementPath(pathname);
}
function isAdministrationPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}
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
function loginUrl(requestUrl: URL): URL {
  const login: URL = new URL('/login', requestUrl);
  login.searchParams.set('next', `${requestUrl.pathname}${requestUrl.search}`);
  return login;
}
