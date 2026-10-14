import { useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import AdminIcon from '../../../components/AdminIcon';
import { request } from '../../../lib/api/client';
import type { EditableRecipe } from '../model/types';

interface RecipeDraftDiscardButtonProperties {
  text: Translation;
  tenantSlug: string;
  recipe: EditableRecipe;
  disabled?: boolean;
  compactOnMobile?: boolean;
  onBusyChanged?: (isBusy: boolean) => void;
  onDiscarded: () => Promise<void>;
}

export default function RecipeDraftDiscardButton(
  properties: RecipeDraftDiscardButtonProperties,
): JSX.Element {
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const label: string = isDiscarding
    ? properties.text.recipeEditor.discardingDraft
    : properties.text.recipeEditor.discardDraft;
  const confirmation: string = properties.recipe.hasPublishedRevision
    ? properties.text.recipeEditor.discardChangesConfirmation
    : properties.text.recipeEditor.discardNewRecipeConfirmation;

  async function discard(): Promise<void> {
    if (isDiscarding || properties.disabled === true) return;
    setIsDiscarding(true);
    setHasFailed(false);
    properties.onBusyChanged?.(true);
    try {
      await request<void>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipe.publicId}/draft`,
        { method: 'DELETE' },
      );
      await properties.onDiscarded();
    } catch (_error: unknown) {
      setHasFailed(true);
    } finally {
      setIsConfirming(false);
      setIsDiscarding(false);
      properties.onBusyChanged?.(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        className="button--secondary"
        disabled={properties.disabled === true || isDiscarding}
        onClick={(): void => setIsConfirming(true)}
        aria-label={label}
        title={label}
      >
        {properties.compactOnMobile === true ? (
          <>
            <span className="recipe-editor-action-bar__button-icon">
              <AdminIcon name="delete" />
            </span>
            <span className="recipe-editor-action-bar__button-label">{label}</span>
          </>
        ) : (
          label
        )}
      </button>
      {isConfirming ? (
        <MessageDialog
          kind="confirmation"
          text={properties.text.dialog}
          title={properties.text.recipeEditor.discardDraft}
          message={confirmation.replace('{title}', properties.recipe.title)}
          confirmLabel={
            isDiscarding
              ? properties.text.recipeEditor.discardingDraft
              : properties.text.recipeEditor.discardDraft
          }
          busy={isDiscarding}
          onClose={(): void => setIsConfirming(false)}
          onConfirm={(): void => void discard()}
        />
      ) : null}
      {hasFailed && !isConfirming ? (
        <MessageDialog
          kind="error"
          text={properties.text.dialog}
          message={properties.text.errors.requestFailed}
          onClose={(): void => setHasFailed(false)}
        />
      ) : null}
    </span>
  );
}
