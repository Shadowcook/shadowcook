import { useEffect, useState } from 'react';
import { request } from '../../../lib/api/client';

export type TenantSlugStatus =
  'idle' | 'invalid' | 'checking' | 'available' | 'unavailable' | 'failed';

interface SlugCheck {
  key: string;
  status: TenantSlugStatus;
}

export function useTenantSlugAvailability(publicId: string | null, slug: string): TenantSlugStatus {
  const key: string = JSON.stringify([publicId, slug]);
  const valid: boolean = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const [check, setCheck] = useState<SlugCheck | null>(null);

  useEffect((): (() => void) | undefined => {
    if (publicId === null || !valid) return undefined;
    setCheck({ key, status: 'checking' });
    const controller: AbortController = new AbortController();
    const timeout: number = window.setTimeout((): void => {
      void request<{ available: boolean }>(
        `/admin/tenants/${encodeURIComponent(publicId)}/slug-availability?${new URLSearchParams({ slug })}`,
        { signal: controller.signal },
      )
        .then((response: { available: boolean }): void => {
          if (!controller.signal.aborted)
            setCheck({ key, status: response.available ? 'available' : 'unavailable' });
        })
        .catch((): void => {
          if (!controller.signal.aborted) setCheck({ key, status: 'failed' });
        });
    }, 250);
    return (): void => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, publicId, slug, valid]);

  if (publicId === null || slug.length === 0) return 'idle';
  if (!valid) return 'invalid';
  return check?.key === key ? check.status : 'checking';
}
