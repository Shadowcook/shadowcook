const cookbookNamePattern: RegExp = /^(?=(?:.*[A-Za-z0-9]){3})[A-Za-z0-9]/;

export function isValidCookbookName(value: string): boolean {
  const trimmedName: string = value.trim();
  return trimmedName.length <= 120 && cookbookNamePattern.test(trimmedName);
}

export function cookbookSlugBase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
