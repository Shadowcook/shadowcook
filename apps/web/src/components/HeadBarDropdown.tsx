import { useEffect, useRef } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface Properties {
  label: string;
  icon: IconDefinition;
  children: ReactNode;
}

export default function HeadBarDropdown({ label, icon, children }: Properties): JSX.Element {
  const dropdownRef: RefObject<HTMLDetailsElement | null> = useRef<HTMLDetailsElement>(null);

  useEffect((): (() => void) => {
    function closeOutside(event: PointerEvent): void {
      const dropdown: HTMLDetailsElement | null = dropdownRef.current;
      if (dropdown !== null && event.target instanceof Node && !dropdown.contains(event.target)) {
        dropdown.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      const dropdown: HTMLDetailsElement | null = dropdownRef.current;
      if (event.key === 'Escape' && dropdown?.open === true) {
        dropdown.open = false;
        dropdown.querySelector('summary')?.focus();
      }
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return (): void => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details className="head-bar__dropdown" name="head-bar-menu" ref={dropdownRef}>
      <summary className="head-bar__icon-button" aria-label={label} title={label}>
        <FontAwesomeIcon icon={icon} aria-hidden="true" />
      </summary>
      <div className="head-bar__menu">{children}</div>
    </details>
  );
}
