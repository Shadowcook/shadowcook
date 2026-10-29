import type { RecipeContentMetadata, RecipeDiet } from '../cookbook/recipe-facts.js';
import type { UnitDimension } from '../unit-domain.js';
import type { UnitTranslations } from '../unit-translations.js';

export interface SourceIdentity {
  instanceUrl: string;
  tenantPublicId: string | null;
  publicId: string;
}

export interface PortableIngredient {
  key: string;
  name: string;
  aliases?: string[];
  source?: SourceIdentity;
}

export interface UnitConversion {
  dimension: UnitDimension;
  baseFactor: string;
  baseOffset: string;
}

export interface PortableUnit {
  key: string;
  name: string;
  symbol: string;
  conversion?: UnitConversion;
  source?: SourceIdentity;
}

export interface PortableEntry {
  key: string;
  kind: 'ingredient' | 'text' | 'special';
  ingredientKey?: string;
  alias?: string;
  text?: string;
  specialKind?: string;
  amount?: string;
  unitKey?: string;
  isOptional?: boolean;
  note?: string;
}

export interface PortableStep {
  key: string;
  instruction: string;
  entries: PortableEntry[];
}

export interface PortableVariant {
  key: string;
  name: string;
  slug: string;
  isDefault: boolean;
  isVisible: boolean;
  includedStepKeys: string[];
}

export interface PortableRecipeReference {
  key: string;
  title: string;
  url: string;
  source?: SourceIdentity;
}

export interface PortableRecipe {
  title: string;
  summary?: string | null;
  categoryPaths?: string[][];
  metadata?: Partial<RecipeContentMetadata>;
  diet?: RecipeDiet | null;
  provenance?: {
    source: SourceIdentity;
    revisionPublicId?: string;
    lineagePublicId?: string;
  };
  steps: PortableStep[];
  variants: PortableVariant[];
}

export interface PortableRecipeDocument {
  format: 'shadowcook-recipe';
  formatVersion: 1;
  ingredients: PortableIngredient[];
  units: PortableUnit[];
  recipeReferences?: PortableRecipeReference[];
  recipe: PortableRecipe;
}

export interface ImportIssue {
  path: string;
  code: 'JSON' | 'SCHEMA' | 'DUPLICATE' | 'REFERENCE' | 'VARIANT' | 'DURATION' | 'URL' | 'LIMIT';
}

export type EntityMapping =
  | { key: string; action: 'EXISTING'; publicId: string; addAsAlias?: boolean }
  | { key: string; action: 'CREATE'; name: string; symbol?: string };

export interface ImportInput {
  json: string;
  slug: string;
  categoryPublicIds: string[];
  ingredients: EntityMapping[];
  units: EntityMapping[];
}

export interface MatchCandidate {
  translations?: UnitTranslations;
  publicId: string;
  name: string;
  symbol: string | null;
  conversion: UnitConversion | null;
  match: 'EXACT' | 'ALIAS' | 'SIMILAR' | 'DEFINITION';
}

export interface EntitySuggestions {
  key: string;
  candidates: MatchCandidate[];
  suggestedPublicId: string | null;
}

export interface ImportPermissions {
  canAddIngredientAliases: boolean;
  canCreateIngredients: boolean;
  canCreateUnits: boolean;
  canCreateVariants: boolean;
}
