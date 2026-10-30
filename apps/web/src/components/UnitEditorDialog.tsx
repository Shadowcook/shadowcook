import { useId } from 'react';
import type { JSX, ReactNode, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import Dialog from './Dialog';

interface UnitEditorDialogProperties {
  text: Translation;
  title: string;
  description: string;
  busy: boolean;
  error: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}

export default function UnitEditorDialog(properties: UnitEditorDialogProperties): JSX.Element {
  const formId: string = useId();

  return (
    <Dialog
      kind="information"
      title={properties.title}
      message={properties.description}
      icon={null}
      busy={properties.busy}
      onClose={properties.onClose}
      actions={
        <>
          <button
            type="button"
            className="button--secondary"
            disabled={properties.busy}
            onClick={properties.onClose}
          >
            {properties.text.admin.cancel}
          </button>
          <button type="submit" form={formId} disabled={properties.busy}>
            {properties.text.admin.save}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={properties.onSubmit}>
        <fieldset className="unit-editor-form" disabled={properties.busy}>
          {properties.children}
        </fieldset>
        {properties.error.length > 0 ? (
          <p className="message" role="alert">
            {properties.error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
