export function isReauthenticationRequest(pathname: string, search: string): boolean {
  return pathname === '/login' && new URLSearchParams(search).get('reauth') === '1';
}

export function reauthenticationLoginUrl(returnPath: string): string {
  const parameters: URLSearchParams = new URLSearchParams({ next: returnPath, reauth: '1' });
  return `/login?${parameters.toString()}`;
}
