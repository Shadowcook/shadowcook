import { useState } from 'react';
import type { JSX } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilePdf } from '@fortawesome/free-solid-svg-icons';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import type { RecipeDetail } from '../model/types';

interface Properties {
  recipe: RecipeDetail;
  text: Translation;
  tenantSlug?: string;
}

export default function RecipePdfDownloadButton({
  recipe,
  text,
  tenantSlug,
}: Properties): JSX.Element {
  const [busy, setBusy] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);

  async function download(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const pdfDownload: typeof import('../model/download-recipe-pdf') =
        await import('../model/download-recipe-pdf');
      await pdfDownload.downloadRecipePdf(recipe, text, tenantSlug);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="content-actions__toggle recipe-pdf-download"
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? text.recipePdf.downloading : text.recipePdf.download}
        title={busy ? text.recipePdf.downloading : text.recipePdf.download}
        onClick={download}
      >
        <FontAwesomeIcon icon={faFilePdf} aria-hidden="true" />
      </button>
      {failed ? (
        <MessageDialog
          kind="error"
          text={text.dialog}
          title={text.recipePdf.errorTitle}
          message={text.recipePdf.failed}
          onClose={(): void => setFailed(false)}
        />
      ) : null}
    </>
  );
}
