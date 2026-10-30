import { variantMetadataExpression, type RecipeFactsRow } from './recipe-facts.js';

export interface RecipeSummaryVariant extends Pick<RecipeFactsRow, 'metadata' | 'diet'> {
  variant_key: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_visible: boolean;
}

export const recipeSummaryVariantsSql: string = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'variant_key', variant.variant_key,
    'name', variant.name,
    'slug', variant.slug,
    'is_default', variant.is_default,
    'is_visible', variant.is_visible,
    'metadata', ${variantMetadataExpression('variant')},
    'diet', variant.diet
  ) ORDER BY variant.name, variant.variant_key)
  FROM recipe_variant AS variant
  WHERE variant.recipe_revision_id = recipe_revision.id
    AND (variant.is_visible OR variant.is_default)
), '[]'::jsonb)`;
