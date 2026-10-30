export function publicCanonicalUrl(requestUrl: URL, pathname: '/' | '/explore'): string {
  const origin: string = import.meta.env.PUBLIC_WEB_ORIGIN || requestUrl.origin;
  return new URL(pathname, origin).href;
}
