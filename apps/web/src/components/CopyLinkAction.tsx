import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink } from '@fortawesome/free-solid-svg-icons';
import type { Translation } from '../i18n';
import MessageDialog from './MessageDialog';

interface Properties {
  text: Translation;
  path?: string;
}

export default function CopyLinkAction({ text, path }: Properties): JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect((): (() => void) | undefined => {
    if (!copied) return undefined;
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => setCopied(false), 3000);
    return (): void => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      const url: string =
        path === undefined ? window.location.href : new URL(path, window.location.origin).href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className="content-actions__item"
        onClick={(): void => {
          void copy();
        }}
      >
        <FontAwesomeIcon icon={faLink} aria-hidden="true" />
        {text.recipeEditor.copyShareLink}
      </button>
      {copied
        ? createPortal(
            <p className="toast" role="status">
              {text.reports.linkCopied}
            </p>,
            document.body,
          )
        : null}
      {failed ? (
        <MessageDialog
          kind="error"
          text={text.dialog}
          message={text.errors.requestFailed}
          onClose={(): void => setFailed(false)}
        />
      ) : null}
    </>
  );
}
