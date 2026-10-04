import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';

interface AiContextDialogProperties {
  text: Translation;
  targetName: string;
  targetType: 'TENANT' | 'RECIPE' | 'CATEGORY';
  targetPublicId: string;
  tenantSlug: string;
  onClose: () => void;
  onError: () => void;
}

export default function AiContextDialog(properties: AiContextDialogProperties): JSX.Element {
  const [durationHours, setDurationHours] = useState<number>(8);
  const [url, setUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function createContext(): Promise<void> {
    setIsCreating(true);
    setErrorMessage('');
    try {
      const response: Response = await fetch(
        `/api/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/ai-contexts`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scopeType: properties.targetType,
            scopePublicId: properties.targetPublicId,
            durationHours,
          }),
        },
      );
      if (!response.ok) throw new Error('AI context creation failed');
      const created: { url: string } = await response.json();
      setUrl(created.url);
    } catch (_error: unknown) {
      setErrorMessage(properties.text.errors.requestFailed);
      properties.onError();
    } finally {
      setIsCreating(false);
    }
  }

  async function copyUrl(): Promise<void> {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_error: unknown) {
      setErrorMessage(properties.text.errors.requestFailed);
      properties.onError();
    }
  }

  return (
    <div className="recipe-share-dialog-backdrop">
      <section
        className="recipe-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-context-dialog-title"
      >
        <div className="recipe-share-dialog__heading">
          <div>
            <p className="eyebrow">{properties.text.recipeEditor.aiContext}</p>
            <h2 id="ai-context-dialog-title">{properties.text.recipeEditor.aiContextTitle}</h2>
          </div>
          <button type="button" className="button--secondary" onClick={properties.onClose}>
            {properties.text.recipeEditor.closeShareDialog}
          </button>
        </div>
        <p>
          {properties.text.recipeEditor.aiContextDescription.replace(
            '{name}',
            properties.targetName,
          )}
        </p>
        <label className="recipe-share-dialog__name">
          {properties.text.recipeEditor.aiContextDuration}
          <select
            value={durationHours}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              setDurationHours(Number(event.currentTarget.value))
            }
          >
            <option value={4}>{properties.text.recipeEditor.aiContextFourHours}</option>
            <option value={8}>{properties.text.recipeEditor.aiContextEightHours}</option>
            <option value={24}>{properties.text.recipeEditor.aiContextTwentyFourHours}</option>
          </select>
        </label>
        <button type="button" disabled={isCreating} onClick={(): void => void createContext()}>
          <AdminIcon name="share" />
          {properties.text.recipeEditor.createAiContext}
        </button>
        {errorMessage.length === 0 ? null : (
          <p className="message" role="alert">
            {errorMessage}
          </p>
        )}
        {url === null ? null : (
          <div className="recipe-share-dialog__created">
            <label>
              {properties.text.recipeEditor.aiContextUrl}
              <input readOnly value={url} onFocus={(event): void => event.currentTarget.select()} />
            </label>
            <button
              type="button"
              className="button--secondary"
              onClick={(): void => void copyUrl()}
              aria-label={properties.text.recipeEditor.copyAiContext}
              title={properties.text.recipeEditor.copyAiContext}
            >
              <AdminIcon name="copy" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
