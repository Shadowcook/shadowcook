import { useState } from 'react';
import type { JSX } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import { ApiRequestError } from '../../../lib/api/client';
import { downloadCookbook } from '../model/download-cookbook';

interface Properties {
  text: Translation;
  tenantSlug: string;
}

export default function CookbookDownloadButton({ text, tenantSlug }: Properties): JSX.Element {
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  async function download(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await downloadCookbook(tenantSlug);
    } catch (failure: unknown) {
      const code: string = failure instanceof ApiRequestError ? failure.code : 'REQUEST_FAILED';
      setError(
        code === 'AUTHENTICATION_REQUIRED'
          ? text.cookbookExport.authenticationRequired
          : code === 'TENANT_PERMISSION_REQUIRED' || code === 'PASSWORD_CHANGE_REQUIRED'
            ? text.cookbookExport.permissionRequired
            : text.cookbookExport.failed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="button--secondary cookbook-download"
        disabled={busy}
        aria-busy={busy}
        title={text.cookbookExport.description}
        onClick={download}
      >
        <FontAwesomeIcon
          icon={faDownload}
          aria-hidden="true"
          style={{ width: '1em', height: '1em', flexShrink: 0 }}
        />
        {busy ? text.cookbookExport.downloading : text.cookbookExport.download}
      </button>
      {error.length > 0 ? (
        <MessageDialog
          kind="error"
          text={text.dialog}
          title={text.cookbookExport.errorTitle}
          message={error}
          onClose={(): void => setError('')}
        />
      ) : null}
    </>
  );
}
