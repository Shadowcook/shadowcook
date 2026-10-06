import type { Translation } from '../../../i18n';

export interface RecipeSpecialEntry {
  kind: string;
  label: string;
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
