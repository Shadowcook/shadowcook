export interface ParsedLegacyIngredient {
  canonicalName: string;
  note: string | null;
}

export function parseLegacyIngredient(value: string): ParsedLegacyIngredient {
  const commaIndex: number = firstCommaOutsideParentheses(value);
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

function firstCommaOutsideParentheses(value: string): number {
  let parenthesesDepth: number = 0;
  for (let index: number = 0; index < value.length; index += 1) {
    const character: string = value[index];
    if (character === '(') {
      parenthesesDepth += 1;
      continue;
    }
    if (character === ')' && parenthesesDepth > 0) {
      parenthesesDepth -= 1;
      continue;
    }
    if (character === ',' && parenthesesDepth === 0) return index;
  }
  return -1;
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
