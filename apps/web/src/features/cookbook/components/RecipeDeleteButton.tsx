import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import { request } from '../../../lib/api/client';

interface RecipeDeleteButtonProperties {
  text: Translation;
  tenantSlug: string;
  publicId: string;
  title: string;
  onDeleted: () => Promise<void>;
}

export default function RecipeDeleteButton(properties: RecipeDeleteButtonProperties): JSX.Element {
  const [confirming, setConfirming] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const [confirmationValue, setConfirmationValue] = useState<string>('');
  const isConfirmed: boolean = confirmationValue === properties.text.recipeTrash.confirmationWord;

  async function remove(): Promise<void> {
    if (!isConfirmed || busy) return;
    setBusy(true);
    try {
      await request<void>(
        `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.publicId}`,
        { method: 'DELETE' },
      );
      setConfirming(false);
      await properties.onDeleted();
    } catch (_error: unknown) {
      setConfirming(false);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="button--secondary"
        disabled={busy}
        aria-label={properties.text.recipeTrash.delete}
        title={properties.text.recipeTrash.delete}
        onClick={(): void => {
          setConfirmationValue('');
          setConfirming(true);
        }}
      >
        <AdminIcon name="delete" />
      </button>
      {confirming ? (
        <MessageDialog
          kind="confirmation"
          text={properties.text.dialog}
          title={properties.text.recipeTrash.delete}
          message={properties.text.recipeTrash.confirmation.replace('{title}', properties.title)}
          confirmLabel={properties.text.recipeTrash.delete}
          busy={busy}
          confirmDisabled={!isConfirmed}
          onClose={(): void => setConfirming(false)}
          onConfirm={(): void => void remove()}
        >
          <label>
            {properties.text.recipeTrash.confirmationLabel}
            <input
              type="text"
              value={confirmationValue}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setConfirmationValue(event.currentTarget.value)
              }
            />
          </label>
        </MessageDialog>
      ) : null}
      {failed ? (
        <MessageDialog
          kind="error"
          text={properties.text.dialog}
          message={properties.text.errors.requestFailed}
          onClose={(): void => setFailed(false)}
        />
      ) : null}
    </>
  );
}
