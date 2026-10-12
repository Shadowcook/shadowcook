import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../i18n';

export interface ProfileNames {
  firstName: string;
  lastName: string;
  displayName: string;
}

interface ProfileNameFieldsProperties {
  text: Translation;
  value: ProfileNames;
  onChange: (value: ProfileNames) => void;
}

export function hasValidProfileNames(value: ProfileNames): boolean {
  return [value.firstName, value.lastName, value.displayName].every(
    (name: string): boolean => name.trim().length >= 1 && name.trim().length <= 120,
  );
}

export default function ProfileNameFields({
  text,
  value,
  onChange,
}: ProfileNameFieldsProperties): JSX.Element {
  return (
    <>
      <label>
        {text.accountProfile.firstName}
        <input
          type="text"
          autoComplete="given-name"
          required
          maxLength={120}
          value={value.firstName}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...value, firstName: event.currentTarget.value })
          }
        />
      </label>
      <label>
        {text.accountProfile.lastName}
        <input
          type="text"
          autoComplete="family-name"
          required
          maxLength={120}
          value={value.lastName}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...value, lastName: event.currentTarget.value })
          }
        />
      </label>
      <label>
        {text.accountProfile.displayName}
        <input
          type="text"
          autoComplete="nickname"
          required
          maxLength={120}
          value={value.displayName}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...value, displayName: event.currentTarget.value })
          }
        />
      </label>
      <p className="field-hint">{text.accountProfile.nameRequirements}</p>
    </>
  );
}
