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

export function isKnownSystemPage(pathname: string): boolean {
  if (
    [
      '/',
      '/explore',
      '/login',
      '/register',
      '/imprint',
      '/privacy-statement',
      '/admin',
      '/admin/reports',
      '/admin/settings',
      '/admin/tenants',
      '/admin/tenants/new',
      '/admin/units',
      '/admin/users',
      '/settings',
      '/settings/profile',
      '/settings/email',
      '/settings/cookbooks',
      '/settings/password',
    ].includes(pathname)
  )
    return true;
  if (
    /^\/admin\/settings\/(?:reports|smtp|email-templates|authentication|registration|cookbook-slug-blocked-terms|media|frontpage|legal-documents)$/.test(
      pathname,
    )
  )
    return true;
  return (
    /^\/(?:invitations|password-reset|verify-email|user-invitations|shared)\/[^/]+$/.test(
      pathname,
    ) ||
    /^\/settings\/email\/verify\/[^/]+$/.test(pathname) ||
    /^\/admin\/reports\/[^/]+$/.test(pathname)
  );
}
