import type { JSX } from 'react';
import type { Translation } from '../../../i18n';

export default function ManagementPlaceholder({ text }: { text: Translation }): JSX.Element {
  return (
    <section className="recipe-editor management-placeholder">
      <p className="eyebrow">{text.tenantNavigation.title}</p>
      <h1>{text.tenantNavigation.title}</h1>
      <p className="lede">{text.tenantNavigation.selectArea}</p>
    </section>
  );
}
