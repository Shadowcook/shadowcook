/** Web route classification only; cookbook allocation uses the API slug policy. */
export function isSystemPath(pathname: string): boolean {
  const segment: string = pathname.split('/').filter(Boolean)[0] ?? '';
  return [
    '',
    'explore',
    'login',
    'logout',
    'register',
    'settings',
    'admin',
    'api',
    'assets',
    'auth',
    'health',
    'mcp',
    'imprint',
    'privacy-statement',
    'invitations',
    'password-reset',
    'verify-email',
    'user-invitations',
    'shared',
    '.well-known',
  ].includes(segment);
}
