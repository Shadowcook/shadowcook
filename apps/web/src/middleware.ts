import type { MiddlewareHandler } from 'astro';

const apiPrefix: string = '/api';
const defaultApiOrigin: string = 'http://localhost:3000';
const protectedResourceMetadataPath: string = '/.well-known/oauth-protected-resource';
const authorizationServerMetadataPath: string = '/.well-known/oauth-authorization-server';

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
  const apiPath: string | null = oauthDiscoveryApiPath(context.url.pathname);
  if (apiPath === null && !context.url.pathname.startsWith(`${apiPrefix}/`)) return next();
  const resolvedApiPath: string = apiPath ?? context.url.pathname.slice(apiPrefix.length);
  const apiUrl: URL = new URL(`${resolvedApiPath}${context.url.search}`, apiOrigin);
  const requestBody: ArrayBuffer | undefined =
    context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : await context.request.arrayBuffer();
  const headers: Headers = new Headers(context.request.headers);
  headers.set('accept-encoding', 'identity');
  const response: Response = await fetch(apiUrl, {
    method: context.request.method,
    headers,
    body: requestBody,
    redirect: 'manual',
  });
  logAuthenticationProxyResponse(context.url.pathname, context.request.method, response);
  return response;
};

function logAuthenticationProxyResponse(pathname: string, method: string, response: Response): void {
  if (
    pathname !== '/api/oauth/authorize' &&
    pathname !== '/api/oauth/token' &&
    pathname !== '/api/auth/logout'
  )
    return;
  const location: string | null = response.headers.get('location');
  let redirectPath: string | null = null;
  if (location !== null) {
    try {
      redirectPath = new URL(location).pathname;
    } catch (_error: unknown) {
      redirectPath = 'invalid';
    }
  }
  console.info(
    JSON.stringify({
      component: 'api-proxy',
      event: 'authentication-response',
      method,
      path: pathname,
      status: response.status,
      redirectPath,
      contentEncoding: response.headers.get('content-encoding'),
      hasSetCookie: response.headers.has('set-cookie'),
    }),
  );
}

function oauthDiscoveryApiPath(pathname: string): string | null {
  if (
    pathname === protectedResourceMetadataPath ||
    pathname === `${protectedResourceMetadataPath}${apiPrefix}/mcp`
  )
    return protectedResourceMetadataPath;
  if (pathname === `${authorizationServerMetadataPath}${apiPrefix}`)
    return authorizationServerMetadataPath;
  return null;
}

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
