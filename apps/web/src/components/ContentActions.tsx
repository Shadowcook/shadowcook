import { useEffect, useRef } from 'react';
import type { JSX, MouseEvent, ReactNode, RefObject } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsis } from '@fortawesome/free-solid-svg-icons';

interface Properties {
  label: string;
  children: ReactNode;
}

export default function ContentActions({ label, children }: Properties): JSX.Element {
  const dropdownRef: RefObject<HTMLDetailsElement | null> = useRef<HTMLDetailsElement>(null);
  const itemsRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  function positionItems(): void {
    const dropdown: HTMLDetailsElement | null = dropdownRef.current;
    const items: HTMLDivElement | null = itemsRef.current;
    const toggle: HTMLElement | null = dropdown?.querySelector('summary') ?? null;
    if (dropdown?.open !== true || items === null || toggle === null) return;
    const bounds: DOMRect = toggle.getBoundingClientRect();
    const left: number = Math.max(
      16,
      Math.min(bounds.right - items.offsetWidth, window.innerWidth - items.offsetWidth - 16),
    );
    const below: number = bounds.bottom + 8;
    const top: number =
      below + items.offsetHeight <= window.innerHeight - 16
        ? below
        : Math.max(16, bounds.top - items.offsetHeight - 8);
    items.style.left = `${left}px`;
    items.style.top = `${top}px`;
  }

  useEffect((): (() => void) => {
    function closeOutside(event: PointerEvent): void {
      const dropdown: HTMLDetailsElement | null = dropdownRef.current;
      if (dropdown?.open && event.target instanceof Node && !dropdown.contains(event.target)) {
        dropdown.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      const dropdown: HTMLDetailsElement | null = dropdownRef.current;
      if (event.key === 'Escape' && dropdown?.open) {
        event.preventDefault();
        dropdown.open = false;
        dropdown.querySelector('summary')?.focus();
      }
    }

    function closeOnViewportChange(event: Event): void {
      if (event.target instanceof Node && itemsRef.current?.contains(event.target)) return;
      const dropdown: HTMLDetailsElement | null = dropdownRef.current;
      if (dropdown !== null) dropdown.open = false;
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return (): void => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, []);

  function closeAfterAction(event: MouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
    if (event.target.closest('button, a') === null) return;
    const dropdown: HTMLDetailsElement | null = dropdownRef.current;
    if (dropdown === null) return;
    dropdown.open = false;
    dropdown.querySelector('summary')?.focus();
  }

  return (
    <details
      className="content-actions"
      name="content-actions"
      ref={dropdownRef}
      onToggle={positionItems}
    >
      <summary className="content-actions__toggle" aria-label={label} title={label}>
        <FontAwesomeIcon icon={faEllipsis} aria-hidden="true" />
      </summary>
      <div className="content-actions__items" ref={itemsRef} onClick={closeAfterAction}>
        {children}
      </div>
    </details>
  );
}
