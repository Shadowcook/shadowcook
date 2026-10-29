import type { RecipeContentMetadata, RecipeDiet } from '../model/recipe-metadata';
import type { UnitTranslations } from '../../../i18n/unit-localization';
import type { Category } from '../model/types';

export interface ImportConversion {
  dimension: 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';
  baseFactor: string;
  baseOffset: string;
}

export interface ImportEntity {
  key: string;
  name: string;
  aliases?: string[];
  symbol?: string;
  conversion?: ImportConversion;
}

export interface ImportEntry {
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

export interface ImportStep {
  key: string;
  instruction: string;
  entries: ImportEntry[];
}

export interface ImportVariant {
  metadata?: Partial<RecipeContentMetadata>;
  diet?: RecipeDiet | null;
  key: string;
  name: string;
  slug: string;
  isDefault: boolean;
  isVisible: boolean;
  includedStepKeys: string[];
}

export interface ImportDocument {
  format: 'shadowcook-recipe';
  formatVersion: 1;
  ingredients: ImportEntity[];
  units: ImportEntity[];
  recipeReferences?: { key: string; title: string; url: string }[];
  recipe: {
    title: string;
    summary?: string | null;
    categoryPaths?: string[][];
    metadata?: Partial<RecipeContentMetadata>;
    diet?: RecipeDiet | null;
    provenance?: { source: { instanceUrl: string } };
    steps: ImportStep[];
    variants: ImportVariant[];
  };
}

export interface ImportCandidate {
  translations?: UnitTranslations;
  publicId: string;
  name: string;
  symbol: string | null;
  conversion: ImportConversion | null;
  match: 'EXACT' | 'ALIAS' | 'SIMILAR' | 'DEFINITION';
}

export interface ImportSuggestions {
  key: string;
  candidates: ImportCandidate[];
  suggestedPublicId: string | null;
}

export interface ImportPreview {
  categories: Category[];
  document: ImportDocument;
  permissions: {
    canAddIngredientAliases: boolean;
    canCreateIngredients: boolean;
    canCreateUnits: boolean;
    canCreateVariants: boolean;
  };
  ingredients: ImportSuggestions[];
  units: ImportSuggestions[];
}

export interface ImportChoice {
  addAsAlias?: boolean;
  candidate?: ImportCandidate;
  key: string;
  selected: string;
  name: string;
  symbol: string;
}

export type ImportMapping =
  | { key: string; action: 'EXISTING'; publicId: string; addAsAlias?: boolean }
  | { key: string; action: 'CREATE'; name: string; symbol?: string };

export interface ImportIssue {
  path: string;
  code: 'JSON' | 'SCHEMA' | 'DUPLICATE' | 'REFERENCE' | 'VARIANT' | 'DURATION' | 'URL' | 'LIMIT';
}

export interface ImportVariantDetails {
  key: string;
  name: string;
  slug: string;
}

export interface ImportReviewSubmission {
  document: ImportDocument;
  slug: string;
  categoryPublicIds: string[];
  ingredients: ImportMapping[];
  units: ImportMapping[];
}
