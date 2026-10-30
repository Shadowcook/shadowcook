const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const formContentTypes: readonly string[] = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

export function isAllowedRequestOrigin(request: Request, url: URL): boolean {
  if (safeMethods.has(request.method) || request.headers.get('origin') === url.origin) return true;

  const contentType: string | null = request.headers.get('content-type');
  if (contentType === null) return false;
  const normalizedContentType: string = contentType.toLowerCase();
  const mediaType: string = normalizedContentType.split(';')[0]!.trim();
  if (
    request.method === 'POST' &&
    url.pathname === '/api/oauth/token' &&
    mediaType === 'application/x-www-form-urlencoded'
  )
    return true;

  return !formContentTypes.some((formContentType: string): boolean =>
    normalizedContentType.includes(formContentType),
  );
}
