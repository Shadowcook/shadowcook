import type { Translation } from '../../../i18n';

export interface RecipeSpecialEntry {
  kind: string;
  icon: string;
  label: string;
}

export function recipeSpecialEntries(text: Translation): RecipeSpecialEntry[] {
  return [
    { kind: 'NO_ICON', icon: '', label: text.recipeEditor.specialNoIcon },
    { kind: 'REMOVE', icon: '−', label: text.recipeEditor.specialRemove },
    { kind: 'ADD', icon: '+', label: text.recipeEditor.specialAdd },
    { kind: 'INFO', icon: 'ℹ', label: text.recipeEditor.specialInfo },
    { kind: 'IMPORTANT', icon: '⚠', label: text.recipeEditor.specialImportant },
    { kind: 'COOK', icon: '🍳', label: text.recipeEditor.specialCook },
    { kind: 'COOL', icon: '❄', label: text.recipeEditor.specialCool },
    { kind: 'HEAT', icon: '🔥', label: text.recipeEditor.specialHeat },
    { kind: 'WAIT', icon: '⏳', label: text.recipeEditor.specialWait },
    { kind: 'WORK_STEP', icon: '⚒', label: text.recipeEditor.specialWorkStep },
  ];
}
