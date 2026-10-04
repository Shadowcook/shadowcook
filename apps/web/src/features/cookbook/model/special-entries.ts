import type { Translation } from '../../../i18n';

export interface RecipeSpecialEntry {
  kind: string;
  label: string;
}

const iconPathByKind: Readonly<Record<string, string>> = {
  ADD: '/font-awesome/solid/plus.svg',
  COOL: '/font-awesome/solid/snowflake.svg',
  COOK: '/font-awesome/solid/spoon.svg',
  HEAT: '/font-awesome/solid/fire-burner.svg',
  IMPORTANT: '/font-awesome/solid/triangle-exclamation.svg',
  INFO: '/font-awesome/solid/circle-info.svg',
  REMOVE: '/font-awesome/solid/minus.svg',
  WAIT: '/font-awesome/solid/clock.svg',
  WORK_STEP: '/font-awesome/solid/screwdriver-wrench.svg',
};

const legacyCaptionByKind: Readonly<Record<string, string>> = {
  NO_ICON: '<no icon>',
  REMOVE: '<remove>',
  ADD: '<add>',
  INFO: '<info>',
  IMPORTANT: '<important>',
  COOK: '<cook>',
  COOL: '<cool>',
  HEAT: '<heat>',
  WAIT: '<wait>',
  WORK_STEP: '<work step>',
};

export function specialIngredientIconPath(kind: string): string | null {
  return iconPathByKind[kind.toUpperCase()] ?? null;
}

export function specialIngredientCaption(kind: string, ingredientName: string): string | null {
  const legacyCaption: string | undefined = legacyCaptionByKind[kind.toUpperCase()];
  return legacyCaption?.toLowerCase() === ingredientName.toLowerCase() ? null : ingredientName;
}

export function recipeSpecialEntries(text: Translation): RecipeSpecialEntry[] {
  return [
    { kind: 'NO_ICON', label: text.recipeEditor.specialNoIcon },
    { kind: 'REMOVE', label: text.recipeEditor.specialRemove },
    { kind: 'ADD', label: text.recipeEditor.specialAdd },
    { kind: 'INFO', label: text.recipeEditor.specialInfo },
    { kind: 'IMPORTANT', label: text.recipeEditor.specialImportant },
    { kind: 'COOK', label: text.recipeEditor.specialCook },
    { kind: 'COOL', label: text.recipeEditor.specialCool },
    { kind: 'HEAT', label: text.recipeEditor.specialHeat },
    { kind: 'WAIT', label: text.recipeEditor.specialWait },
    { kind: 'WORK_STEP', label: text.recipeEditor.specialWorkStep },
  ];
}
