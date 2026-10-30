export function isReauthenticationRequest(pathname: string, search: string): boolean {
  return pathname === '/login' && new URLSearchParams(search).get('reauth') === '1';
}

export function reauthenticationLoginUrl(returnPath: string): string {
  const parameters: URLSearchParams = new URLSearchParams({ next: returnPath, reauth: '1' });
  return `/login?${parameters.toString()}`;
}

export function postLoginDestination(pathname: string, search: string): string {
  if (pathname !== '/login') return `${pathname}${search}`;
  const requestedPath: string | null = new URLSearchParams(search).get('next');
  if (
    requestedPath === null ||
    !requestedPath.startsWith('/') ||
    requestedPath.startsWith('//') ||
    /[\\\u0000-\u0020]/.test(requestedPath)
  )
    return '/explore';
  return requestedPath;
}
