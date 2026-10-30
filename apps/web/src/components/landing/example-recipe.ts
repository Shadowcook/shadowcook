import type { IngredientUsage, RecipeStep } from '../../features/cookbook/model/types';

// Authored demonstration content stays in its original language.
export const exampleRecipeTitle: string = 'Lemon & basil pasta';
function ingredient(name: string, amount: string, unit: string, order: number): IngredientUsage {
  return {
    sort_order: order,
    amount,
    unit_public_id: null,
    unit_symbol: unit,
    unit_localization_key: null,
    unit_translations: {},
    ingredient_public_id: null,
    ingredient_name: name,
    is_catalog_ingredient: false,
    special_kind: null,
    note: null,
    is_optional: false,
  };
}
export const exampleRecipeSteps: RecipeStep[] = [
  {
    public_id: 'example-boil',
    sort_order: 0,
    ingredients: [ingredient('pasta', '200', 'g', 0)],
    instruction:
      'Cook the pasta in salted water until al dente. Save a cup of the cooking water before draining.',
  },
  {
    public_id: 'example-finish',
    sort_order: 1,
    ingredients: [
      ingredient('olive oil', '2', 'tbsp', 0),
      ingredient('lemon', '1', '', 1),
      ingredient('fresh basil', '10', 'g', 2),
    ],
    instruction:
      'Toss the warm pasta with olive oil, lemon zest and juice. Add a splash of cooking water, then fold in the basil.',
  },
];
