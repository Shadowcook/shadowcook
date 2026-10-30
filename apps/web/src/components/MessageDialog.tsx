import { useRef } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCircleInfo,
  faCircleExclamation,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Translation } from '../i18n';
import Dialog from './Dialog';
import type { DialogKind } from './Dialog';

interface MessageDialogBaseProperties {
  text: Translation['dialog'];
  title?: string;
  message: string;
  children?: ReactNode;
  busy?: boolean;
  onClose: () => void;
}

export type MessageDialogProperties = MessageDialogBaseProperties &
  (
    | { kind: 'information' | 'error'; dismissLabel?: string }
    | {
        kind: 'confirmation';
        confirmLabel?: string;
        cancelLabel?: string;
        confirmDisabled?: boolean;
        onConfirm: () => void;
      }
  );

const icons: Readonly<Record<DialogKind, IconDefinition>> = {
  information: faCircleInfo,
  error: faCircleExclamation,
  confirmation: faTriangleExclamation,
};

export default function MessageDialog(properties: MessageDialogProperties): JSX.Element {
  const initialFocusRef: RefObject<HTMLButtonElement | null> = useRef<HTMLButtonElement>(null);
  const defaultTitles: Readonly<Record<DialogKind, string>> = {
    information: properties.text.informationTitle,
    error: properties.text.errorTitle,
    confirmation: properties.text.confirmationTitle,
  };

  return (
    <Dialog
      kind={properties.kind}
      title={properties.title ?? defaultTitles[properties.kind]}
      message={properties.message}
      busy={properties.busy}
      initialFocusRef={initialFocusRef}
      onClose={properties.onClose}
      icon={
        <FontAwesomeIcon
          icon={icons[properties.kind]}
          className="application-dialog__icon"
          aria-hidden="true"
        />
      }
      actions={
        properties.kind === 'confirmation' ? (
          <>
            <button
              type="button"
              className="button--secondary"
              ref={initialFocusRef}
              disabled={properties.busy}
              onClick={properties.onClose}
            >
              {properties.cancelLabel ?? properties.text.cancel}
            </button>
            <button
              type="button"
              disabled={properties.busy || properties.confirmDisabled}
              onClick={properties.onConfirm}
            >
              {properties.confirmLabel ?? properties.text.confirm}
            </button>
          </>
        ) : (
          <button
            type="button"
            ref={initialFocusRef}
            disabled={properties.busy}
            onClick={properties.onClose}
          >
            {properties.dismissLabel ?? properties.text.acknowledge}
          </button>
        )
      }
    >
      {properties.children}
    </Dialog>
  );
}
