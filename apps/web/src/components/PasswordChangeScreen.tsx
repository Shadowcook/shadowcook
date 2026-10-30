import type { JSX } from 'react';
import PasswordChangeForm, { type PasswordChangeFormProperties } from './PasswordChangeForm';

export default function PasswordChangeScreen(
  properties: PasswordChangeFormProperties,
): JSX.Element {
  const { text }: PasswordChangeFormProperties = properties;
  return (
    <section className="panel auth-panel">
      <p className="eyebrow">{text.passwordChange.title}</p>
      <h1>{text.passwordChange.title}</h1>
      <p className="lede">{text.passwordChange.subtitle}</p>
      <PasswordChangeForm {...properties} />
    </section>
  );
}
