import type { IngredientUsage, RecipeDetail } from '../../src/features/cookbook/model/types.ts';
import { emptyRecipeMetadata } from '../../src/features/cookbook/model/recipe-metadata.ts';

const flour: IngredientUsage = {
  sort_order: 0,
  amount: '125.5000',
  unit_public_id: 'grams',
  unit_symbol: 'g',
  unit_localization_key: null,
  unit_translations: {},
  ingredient_public_id: 'flour',
  ingredient_name: 'Mehl',
  is_catalog_ingredient: true,
  special_kind: null,
  note: 'gesiebt',
  is_optional: false,
};

export function pdfRecipeFixture(): RecipeDetail {
  return {
    metadata: emptyRecipeMetadata(),
    diet: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: null,
    public_id: '6b58edc7-ec19-4c1a-a410-45f4c296bca5',
    cookbook_name: 'Ursulas Familienküche',
    version: 7,
    slug: 'kaesekuchen',
    title: 'Käsekuchen mit süßen Früchten',
    summary: 'Ein cremiger Kuchen.\nFür gemütliche Nachmittage.',
    creator_display_name: 'Ursula Müller',
    contributors: [{ display_name: 'Ursula Müller' }, { display_name: 'Thomas Becker' }],
    can_edit: false,
    can_share: false,
    selectedVariant: 'ohne-zucker',
    variants: [
      {
        variant_key: 'default',
        name: 'Original',
        slug: 'original',
        is_default: true,
        is_visible: true,
      },
      {
        variant_key: 'sugar-free',
        name: 'Ohne Zucker',
        slug: 'ohne-zucker',
        is_default: false,
        is_visible: true,
      },
    ],
    recipe_links: [
      {
        public_id: '1464570b-f8a5-4fe7-8c29-1113b4407bfd',
        slug: 'vanillesosse',
        title: 'Vanillesoße',
      },
    ],
    steps: [
      {
        public_id: 'step-one',
        sort_order: 0,
        instruction: 'Mehl sieben.\n  Anschließend gründlich verrühren.',
        ingredients: [
          flour,
          {
            ...flour,
            sort_order: 1,
            amount: '2.0000',
            unit_public_id: 'teaspoons',
            unit_symbol: 'tsp',
            unit_translations: { de: { name: 'Teelöffel', symbol: 'TL' } },
            ingredient_public_id: 'vanilla',
            ingredient_name: 'Vanille',
            is_optional: true,
            note: 'nach Geschmack',
          },
        ],
      },
      {
        public_id: 'step-two',
        sort_order: 1,
        instruction: 'Mit {recipe:1464570b-f8a5-4fe7-8c29-1113b4407bfd} servieren.',
        ingredients: [
          { ...flour, amount: '124.5000' },
          {
            ...flour,
            sort_order: 1,
            amount: null,
            unit_public_id: null,
            unit_symbol: null,
            ingredient_public_id: null,
            ingredient_name: '',
            is_catalog_ingredient: false,
            special_kind: 'COOL',
            note: 'Mindestens 30 Minuten abkühlen lassen.',
          },
        ],
      },
    ],
  };
}
