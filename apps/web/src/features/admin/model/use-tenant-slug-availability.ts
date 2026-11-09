import { useEffect, useState } from 'react';
import { request } from '../../../lib/api/client';

export type TenantSlugStatus =
  'idle' | 'invalid' | 'checking' | 'available' | 'collision' | 'unavailable' | 'failed';

interface SlugCheck {
  key: string;
  status: TenantSlugStatus;
}

export function useTenantSlugAvailability(
  publicId: string | null,
  slug: string,
  scope: 'admin/tenants' | 'account/cookbooks' = 'admin/tenants',
): TenantSlugStatus {
  const key: string = JSON.stringify([publicId, slug, scope]);
  const valid: boolean = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const [check, setCheck] = useState<SlugCheck | null>(null);

  useEffect((): (() => void) | undefined => {
    if (publicId === null || !valid) return undefined;
    setCheck({ key, status: 'checking' });
    const controller: AbortController = new AbortController();
    const timeout: number = window.setTimeout((): void => {
      void request<{ available: boolean; suffixRequired?: boolean }>(
        `/${scope}/${encodeURIComponent(publicId)}/slug-availability?${new URLSearchParams({ slug })}`,
        { signal: controller.signal },
      )
        .then((response: { available: boolean; suffixRequired?: boolean }): void => {
          if (!controller.signal.aborted)
            setCheck({
              key,
              status: response.available
                ? 'available'
                : response.suffixRequired === true
                  ? 'collision'
                  : 'unavailable',
            });
        })
        .catch((): void => {
          if (!controller.signal.aborted) setCheck({ key, status: 'failed' });
        });
    }, 250);
    return (): void => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, publicId, slug, valid, scope]);

  if (publicId === null || slug.length === 0) return 'idle';
  if (!valid) return 'invalid';
  return check?.key === key ? check.status : 'checking';
}
