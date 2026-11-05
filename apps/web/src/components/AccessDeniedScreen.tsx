import type { JSX } from 'react';
import type { Translation } from '../i18n';
import ErrorState from './errors/ErrorState';

export default function AccessDeniedScreen({ text }: { text: Translation }): JSX.Element {
  return <ErrorState text={text.errorStates} status={403} />;
}
