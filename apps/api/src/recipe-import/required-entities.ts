import type { PortableIngredient, PortableRecipeDocument, PortableUnit } from './types.js';

export function requiredImportEntities(document: PortableRecipeDocument): {
  ingredients: PortableIngredient[];
  units: PortableUnit[];
} {
  const ingredients: Set<string> = new Set();
  const units: Set<string> = new Set();
  for (const step of document.recipe.steps) {
    for (const entry of step.entries) {
      if (entry.ingredientKey !== undefined) ingredients.add(entry.ingredientKey);
      if (entry.unitKey !== undefined) units.add(entry.unitKey);
    }
  }
  return {
    ingredients: document.ingredients.filter((item: PortableIngredient): boolean =>
      ingredients.has(item.key),
    ),
    units: document.units.filter((item: PortableUnit): boolean => units.has(item.key)),
  };
}
