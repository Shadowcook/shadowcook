import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, ReactNode, RefObject, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';

export type DialogKind = 'information' | 'error' | 'confirmation';

export interface DialogProperties {
  kind: DialogKind;
  title: string;
  message: string;
  icon: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  busy?: boolean;
  onClose: () => void;
}

export default function Dialog(properties: DialogProperties): JSX.Element | null {
  const titleId: string = useId();
  const messageId: string = useId();
  const dialogRef: RefObject<HTMLDialogElement | null> = useRef<HTMLDialogElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect((): void => setPortalTarget(document.body), []);

  useEffect((): (() => void) | undefined => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (dialog === null) return undefined;
    const previousFocus: Element | null = document.activeElement;
    dialog.showModal();
    properties.initialFocusRef?.current?.focus();
    return (): void => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [portalTarget, properties.initialFocusRef]);

  if (portalTarget === null) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`application-dialog application-dialog--${properties.kind}`}
      role={properties.kind === 'information' ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      aria-busy={properties.busy === true}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>): void => {
        event.preventDefault();
        if (properties.busy !== true) properties.onClose();
      }}
    >
      <div className="application-dialog__heading">
        {properties.icon}
        <h2 id={titleId}>{properties.title}</h2>
      </div>
      <p id={messageId} className="application-dialog__message">
        {properties.message}
      </p>
      {properties.children}
      <div className="application-dialog__actions">{properties.actions}</div>
    </dialog>,
    portalTarget,
  );
}
