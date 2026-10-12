export interface AccountProfile {
  firstName: string;
  lastName: string;
  displayName: string;
}

export function parseAccountProfile(value: unknown): AccountProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('firstName' in value) || !('lastName' in value) || !('displayName' in value)) return null;
  if (
    !isValidProfileName(value.firstName) ||
    !isValidProfileName(value.lastName) ||
    !isValidProfileName(value.displayName)
  )
    return null;
  return {
    firstName: value.firstName.trim(),
    lastName: value.lastName.trim(),
    displayName: value.displayName.trim(),
  };
}

function isValidProfileName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 120;
}
