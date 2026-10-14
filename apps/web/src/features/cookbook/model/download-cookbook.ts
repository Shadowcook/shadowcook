import { ApiRequestError } from '../../../lib/api/client.ts';

export async function downloadCookbook(tenantSlug: string): Promise<void> {
  const response: Response = await fetch(
    `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/export`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch((): null => null);
    const code: string =
      typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : 'REQUEST_FAILED';
    throw new ApiRequestError(code);
  }
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/zip') {
    throw new ApiRequestError('REQUEST_FAILED');
  }
  const content: Blob = await response.blob();
  const disposition: string = response.headers.get('content-disposition') ?? '';
  const filename: string =
    disposition.match(/filename="([a-z0-9-]+-\d{8}T\d{6}Z\.shadowcook\.zip)"/)?.[1] ??
    `${tenantSlug}.shadowcook.zip`;
  const url: string = URL.createObjectURL(content);
  const link: HTMLAnchorElement = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout((): void => URL.revokeObjectURL(url), 1000);
  }
}
