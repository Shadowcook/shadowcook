import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from '../lib/api/client';
import { cookbookSlugBase, isValidCookbookName } from '../lib/cookbook-name';

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
  const validCookbookName: boolean = isValidCookbookName(cookbookName);
  const slug: string = cookbookSlugBase(normalizedName);

  useEffect((): (() => void) => {
    if (!validCookbookName) {
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
  }, [normalizedName, validCookbookName]);

  const collision: boolean = validCookbookName && preview?.slug === slug && !preview.available;
  return (
    <CookbookSlugPreview
      slug={slug}
      validName={validCookbookName}
      collision={collision}
      text={text}
    />
  );
}

export function CookbookSlugPreview({
  slug,
  validName,
  collision,
  text,
}: {
  slug: string;
  validName: boolean;
  collision: boolean;
  text: Translation;
}): JSX.Element {
  return (
    <output className="cookbook-url-preview" aria-live="polite">
      <span>{text.cookbookUrlPreview.label}</span>
      {validName ? (
        <code>{`${window.location.origin}/${encodeURIComponent(slug)}`}</code>
      ) : (
        <small>{text.cookbookUrlPreview.invalidName}</small>
      )}
      {collision ? <small>{text.cookbookUrlPreview.collision}</small> : null}
    </output>
  );
}
