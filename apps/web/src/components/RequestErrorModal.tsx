import type { JSX } from 'react';
import type { Translation } from '../i18n';
import MessageDialog from './MessageDialog';

export default function RequestErrorModal(properties: {
  text: Translation['dialog'];
  title: string;
  message: string;
  dismiss: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <MessageDialog
      kind="error"
      text={properties.text}
      title={properties.title}
      message={properties.message}
      dismissLabel={properties.dismiss}
      onClose={properties.onClose}
    />
  );
}
