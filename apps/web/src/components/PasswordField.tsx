import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useId, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../i18n';

interface PasswordFieldProperties {
  text: Translation;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
  required?: boolean;
  autoFocus?: boolean;
  hint?: string;
}

export default function PasswordField({
  text,
  label,
  value,
  onChange,
  autoComplete,
  required = false,
  autoFocus = false,
  hint,
}: PasswordFieldProperties): JSX.Element {
  const inputId: string = useId();
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const visibilityLabel: string = isVisible
    ? text.passwordField.hidePassword
    : text.passwordField.showPassword;
  return (
    <div className="password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field__control">
        <input
          id={inputId}
          value={value}
          onChange={onChange}
          type={isVisible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          autoFocus={autoFocus}
        />
        <button
          className="password-field__toggle"
          type="button"
          aria-label={visibilityLabel}
          aria-pressed={isVisible}
          title={visibilityLabel}
          onClick={(): void => setIsVisible((visible: boolean): boolean => !visible)}
        >
          <FontAwesomeIcon aria-hidden="true" icon={isVisible ? faEyeSlash : faEye} />
        </button>
      </div>
      {hint === undefined ? null : <span className="field-hint">{hint}</span>}
    </div>
  );
}
