import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from '../lib/api/client';

interface SlugPreview {
  slug: string;
  available: boolean;
}

interface Properties {
  cookbookName: string;
  text: Translation;
}

export default function CookbookUrlPreview({ cookbookName, text }: Properties): JSX.Element | null {
  const [preview, setPreview] = useState<SlugPreview | null>(null);
  const normalizedName: string = cookbookName.trim();
  const slug: string = cookbookSlugBase(normalizedName);

  useEffect((): (() => void) => {
    if (normalizedName.length < 3) {
      setPreview(null);
      return (): void => undefined;
    }
    let cancelled: boolean = false;
    const timeoutId: number = window.setTimeout((): void => {
      void request<SlugPreview>(
        `/account/cookbook-slug-preview?cookbookName=${encodeURIComponent(normalizedName)}`,
      )
        .then((result: SlugPreview): void => {
          if (!cancelled) setPreview(result);
        })
        .catch((): void => {
          if (!cancelled) setPreview(null);
        });
    }, 200);
    return (): void => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [cookbookName]);

  const url: string = `${window.location.origin}/${encodeURIComponent(slug || '…')}`;
  const collision: boolean =
    normalizedName.length > 0 && preview?.slug === slug && !preview.available;
  return (
    <output className="cookbook-url-preview" aria-live="polite">
      <span>{text.cookbookUrlPreview.label}</span>
      <code>{url}</code>
      {collision ? <small>{text.cookbookUrlPreview.collision}</small> : null}
    </output>
  );
}

function cookbookSlugBase(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || ''
  );
}
