import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useImportFileDrop(disabled: boolean, onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState<boolean>(false);
  const depth: RefObject<number> = useRef<number>(0);

  useEffect((): (() => void) => {
    function isFileDrag(event: DragEvent): boolean {
      return event.dataTransfer?.types.includes('Files') ?? false;
    }

    function enter(event: DragEvent): void {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current += 1;
      if (!disabled) setDragging(true);
    }

    function over(event: DragEvent): void {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }
    }

    function leave(event: DragEvent): void {
      if (!isFileDrag(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }

    function drop(event: DragEvent): void {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!disabled && event.dataTransfer !== null) {
        onFiles(Array.from(event.dataTransfer.files));
      }
    }

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return (): void => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [disabled, onFiles]);

  return dragging && !disabled;
}
