import { useEffect, useState } from 'react';
import { request } from '../../../lib/api/client';

export type RecipeSlugStatus =
  'idle' | 'checking' | 'available' | 'conflict' | 'failed' | 'invalid';

interface SlugCheck {
  key: string;
  status: RecipeSlugStatus;
}

const slugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function useRecipeSlugAvailability(
  tenantSlug: string,
  slug: string,
  recipePublicId: string | null,
  savedSlug: string | null,
): RecipeSlugStatus {
  const key: string = JSON.stringify([tenantSlug, slug, recipePublicId]);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const needsCheck: boolean = slugPattern.test(slug) && slug !== savedSlug;

  useEffect((): (() => void) | undefined => {
    if (!needsCheck) return undefined;
    setCheck({ key, status: 'checking' });
    const controller: AbortController = new AbortController();
    const timeout: number = window.setTimeout((): void => {
      const query: URLSearchParams = new URLSearchParams({ slug });
      if (recipePublicId !== null) query.set('excludePublicId', recipePublicId);
      void request<{ available: boolean }>(
        `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipes/slug-availability?${query.toString()}`,
        { signal: controller.signal },
      )
        .then((response: { available: boolean }): void => {
          if (!controller.signal.aborted)
            setCheck({ key, status: response.available ? 'available' : 'conflict' });
        })
        .catch((): void => {
          if (!controller.signal.aborted) setCheck({ key, status: 'failed' });
        });
    }, 250);
    return (): void => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, needsCheck, tenantSlug, slug, recipePublicId]);

  if (slug.length === 0) return 'idle';
  if (!slugPattern.test(slug)) return 'invalid';
  if (!needsCheck) return 'available';
  return check?.key === key ? check.status : 'checking';
}
