export function isAllowedOAuthRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch (_error: unknown) {
    return false;
  }

  if (url.username.length > 0 || url.password.length > 0 || value.includes('#')) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}
