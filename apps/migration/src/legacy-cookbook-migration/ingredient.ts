export interface ParsedLegacyIngredient {
  canonicalName: string;
  note: string | null;
}

export function parseLegacyIngredient(value: string): ParsedLegacyIngredient {
  const commaIndex: number = value.indexOf(',');
  const ingredientPart: string = (commaIndex < 0 ? value : value.slice(0, commaIndex)).trim();
  const commaModifier: string | null =
    commaIndex < 0 ? null : normalizedText(value.slice(commaIndex + 1));
  const parentheticalModifiers: string[] = parentheticalText(ingredientPart);
  const canonicalName: string | null = normalizedText(removeParentheticalText(ingredientPart));
  if (canonicalName === null)
    throw new Error('Legacy ingredient name has no canonical ingredient text.');
  const modifiers: string[] = [...parentheticalModifiers];
  if (commaModifier !== null) modifiers.push(commaModifier);
  return {
    canonicalName,
    note: modifiers.length === 0 ? null : modifiers.join('; '),
  };
}

function parentheticalText(value: string): string[] {
  const modifiers: string[] = [];
  const expression: RegExp = /\(([^()]*)\)/g;
  let match: RegExpExecArray | null = expression.exec(value);
  while (match !== null) {
    const modifier: string | null = normalizedText(match[1]);
    if (modifier !== null) modifiers.push(modifier);
    match = expression.exec(value);
  }
  return modifiers;
}

function removeParentheticalText(value: string): string {
  let result: string = value;
  let previous: string = '';
  while (result !== previous) {
    previous = result;
    result = result.replace(/\([^()]*\)/g, ' ');
  }
  return result;
}

function normalizedText(value: string): string | null {
  const normalized: string = value.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? null : normalized;
}
