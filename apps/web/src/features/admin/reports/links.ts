const uuid: RegExp = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function reportReferenceFromUrl(accountId?: string): string {
  if (typeof window === 'undefined') return '';
  const query: URLSearchParams = new URLSearchParams(window.location.search);
  const value: string = query.get('report') ?? '';
  return uuid.test(value) && (accountId === undefined || query.get('user') === accountId)
    ? value
    : '';
}
export function reportLink(path: string, reportId: string): string {
  if (!uuid.test(reportId)) return path;
  const [base, fragment]: string[] = path.split('#');
  return `${base}?report=${encodeURIComponent(reportId)}${fragment?.startsWith('user-') ? `&user=${fragment.slice(5)}` : ''}${fragment ? `#${fragment}` : ''}`;
}
