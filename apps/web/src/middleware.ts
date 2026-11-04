import { ApiRequestError } from './lib/api/client.ts';
import { errorDocument } from './lib/server/error-document.ts';
import { resolveRequestLocale } from './i18n/locale-preference.ts';
import type { MiddlewareHandler } from 'astro';
import { isAllowedRequestOrigin } from './lib/server/request-origin.ts';

const apiPrefix: string = '/api';
const defaultApiOrigin: string = 'http://localhost:3000';
const protectedResourceMetadataPath: string = '/.well-known/oauth-protected-resource';
const authorizationServerMetadataPath: string = '/.well-known/oauth-authorization-server';

export const onRequest: MiddlewareHandler = async (context, next): Promise<Response> => {
  if (!context.isPrerendered && !isAllowedRequestOrigin(context.request, context.url))
    return new Response(null, { status: 403 });

  const locale: 'en' | 'de' = resolveRequestLocale(
    context.request.headers.get('cookie'),
    import.meta.env?.PUBLIC_DEFAULT_LOCALE,
  );
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  if (requiresAuthentication(context.url.pathname)) {
    let sessionIsValid: boolean = false;
    try {
      const sessionUrl: URL = new URL('/auth/session', apiOrigin);
      const session: Response = await fetch(sessionUrl, {
        headers: { cookie: context.request.headers.get('cookie') ?? '' },
      });
      if (session.status === 403) return errorDocument(locale, 403);
      if (!session.ok && session.status !== 401) return errorDocument(locale, 503);
      sessionIsValid = session.ok;
    } catch (_error: unknown) {
      return errorDocument(locale, 503);
    }
    if (!sessionIsValid) return Response.redirect(loginUrl(context.url), 302);
  }
  const apiPath: string | null = apiProxyPath(context.url.pathname);
  if (apiPath === null) {
    try {
      const response: Response = await next();
      if (
        response.status >= 500 &&
        response.headers.get('content-type')?.includes('text/html') &&
        response.headers.get('x-robots-tag') !== 'noindex'
      )
        return errorDocument(locale, response.status);
      return response;
    } catch (error: unknown) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          component: 'web',
          event: 'document-render-failed',
        }),
      );
      return errorDocument(locale, error instanceof ApiRequestError ? (error.status ?? 503) : 500);
    }
  }
  const apiUrl: URL = new URL(`${apiPath}${context.url.search}`, apiOrigin);
  const requestBody: ArrayBuffer | undefined =
    context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : await context.request.arrayBuffer();
  const headers: Headers = new Headers(context.request.headers);
  headers.set('x-forwarded-for', context.clientAddress);
  headers.delete('forwarded');
  headers.delete('x-real-ip');
  headers.set('accept-encoding', 'identity');
  logAuthenticationProxyRequest(context.url.pathname, context.request.method);
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: context.request.method,
      headers,
      body: requestBody,
      redirect: 'manual',
    });
  } catch (_error: unknown) {
    return Response.json(
      { code: 'UPSTREAM_UNAVAILABLE', error: 'Service unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  logAuthenticationProxyResponse(context.url.pathname, context.request.method, response);
  return response;
};

function logAuthenticationProxyRequest(pathname: string, method: string): void {
  if (!isLoggedAuthenticationPath(pathname)) return;
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      component: 'api-proxy',
      event: 'authentication-request',
      method,
      path: pathname,
    }),
  );
}

function logAuthenticationProxyResponse(
  pathname: string,
  method: string,
  response: Response,
): void {
  if (!isLoggedAuthenticationPath(pathname)) return;
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
      time: new Date().toISOString(),
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

function isLoggedAuthenticationPath(pathname: string): boolean {
  return (
    pathname === '/api/oauth/authorize' ||
    pathname === '/api/oauth/token' ||
    pathname === '/api/auth/logout'
  );
}

function apiProxyPath(pathname: string): string | null {
  if (pathname.startsWith(`${apiPrefix}/`)) return pathname.slice(apiPrefix.length);
  if (pathname === '/mcp') return '/mcp';
  if (
    pathname === protectedResourceMetadataPath ||
    pathname === `${protectedResourceMetadataPath}/mcp` ||
    pathname === `${protectedResourceMetadataPath}${apiPrefix}/mcp`
  )
    return protectedResourceMetadataPath;
  if (
    pathname === authorizationServerMetadataPath ||
    pathname === `${authorizationServerMetadataPath}${apiPrefix}`
  )
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
