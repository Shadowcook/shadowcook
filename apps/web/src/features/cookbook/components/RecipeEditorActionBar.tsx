import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';

interface RecipeEditorActionBarProperties {
  children: ReactNode;
}

export default function RecipeEditorActionBar(
  properties: RecipeEditorActionBarProperties,
): JSX.Element {
  const markerReference: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const barReference: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState<boolean>(false);

  useEffect((): (() => void) | undefined => {
    const marker: HTMLDivElement | null = markerReference.current;
    const bar: HTMLDivElement | null = barReference.current;
    if (marker === null || bar === null) return undefined;

    const header: HTMLElement | null = document.querySelector<HTMLElement>('.head-bar');
    let observer: IntersectionObserver | null = null;

    function updateOffset(): void {
      if (marker === null || bar === null) return;
      const rootFontSize: number = Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      );
      const topOffset: number = (header?.getBoundingClientRect().height ?? 0) + rootFontSize * 0.75;
      bar.style.setProperty('--recipe-editor-toolbar-top', `${topOffset}px`);
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]): void => {
          const entry: IntersectionObserverEntry | undefined = entries[0];
          if (entry !== undefined)
            setIsPinned(!entry.isIntersecting && entry.boundingClientRect.top < topOffset);
        },
        { rootMargin: `-${topOffset}px 0px 0px 0px` },
      );
      observer.observe(marker);
    }

    updateOffset();
    const resizeObserver: ResizeObserver = new ResizeObserver(updateOffset);
    if (header !== null) resizeObserver.observe(header);
    return (): void => {
      observer?.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={markerReference} className="recipe-editor-action-bar__marker" aria-hidden="true" />
      <div
        ref={barReference}
        className={`recipe-editor-action-bar${isPinned ? ' recipe-editor-action-bar--pinned' : ''}`}
      >
        {properties.children}
      </div>
    </>
  );
}
