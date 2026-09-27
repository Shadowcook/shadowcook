import type { JSX } from 'react';
import type { Translation } from '../i18n';

export default function AccessDeniedScreen({ text }: { text: Translation }): JSX.Element {
  return (
    <section className="panel">
      <h1>{text.accessDenied.title}</h1>
      <p className="message" role="alert">
        {text.accessDenied.description}
      </p>
      <a className="button-link" href="/">
        {text.accessDenied.backToCookbook}
      </a>
    </section>
  );
}
