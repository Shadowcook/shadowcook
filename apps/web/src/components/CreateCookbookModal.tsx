import { useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { isValidCookbookName } from '../lib/cookbook-name';
import CookbookUrlPreview from './CookbookUrlPreview';
import StatusMessage from './StatusMessage';

interface Properties {
  text: Translation;
  submitting: boolean;
  onSubmit: (cookbookName: string) => Promise<void>;
  onClose: () => void;
}

export default function CreateCookbookModal({
  text,
  submitting,
  onSubmit,
  onClose,
}: Properties): JSX.Element {
  const [cookbookName, setCookbookName] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const validCookbookName: boolean = isValidCookbookName(cookbookName);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    try {
      await onSubmit(cookbookName.trim());
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal account-settings-panel__create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-cookbook-title"
      >
        <h2 id="create-cookbook-title">{text.accountSettings.createCookbookTitle}</h2>
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
          <label>
            {text.accountSettings.cookbookName}
            <input
              type="text"
              required
              autoFocus
              value={cookbookName}
              onChange={(event): void => setCookbookName(event.currentTarget.value)}
              onBlur={(): void => setCookbookName(cookbookName.trim())}
            />
            <CookbookUrlPreview cookbookName={cookbookName} text={text} />
          </label>
          <div className="modal__actions">
            <button type="submit" disabled={submitting || !validCookbookName}>
              {submitting
                ? text.accountSettings.creatingCookbook
                : text.accountSettings.createCookbook}
            </button>
            <button
              type="button"
              className="button--secondary"
              disabled={submitting}
              onClick={onClose}
            >
              {text.accountSettings.cancelCreateCookbook}
            </button>
          </div>
        </form>
        <StatusMessage message={message} />
      </section>
    </div>
  );
}
