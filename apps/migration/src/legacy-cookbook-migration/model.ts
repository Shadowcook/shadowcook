export interface LegacyCategory {
  id: number;
  name: string;
  parentId: number;
}

export interface LegacyUnit {
  id: number;
  name: string;
  deleted: boolean;
}

export interface LegacyIngredientUsage {
  id: number;
  name: string | null;
  unitId: number;
  amount: string | null;
  sortOrder: number;
}

export interface LegacyStep {
  id: number;
  instruction: string | null;
  sortOrder: number;
  ingredientUsages: LegacyIngredientUsage[];
}

export interface LegacyRecipe {
  id: number;
  name: string;
  description: string | null;
  thumbnail: string | null;
  categoryIds: number[];
  steps: LegacyStep[];
}

export interface LegacyCookbook {
  categories: LegacyCategory[];
  units: LegacyUnit[];
  recipes: LegacyRecipe[];
}

export interface MigrationOptions {
  execute: boolean;
  tenantSlug: string;
  authorPrincipalId: string | null;
  hsqldbJarPath: string;
}

export interface MigrationSummary {
  categories: number;
  tenantUnitsCreated: number;
  tenantIngredientsCreated: number;
  recipes: number;
  steps: number;
  ingredientUsages: number;
  substitutedEmptyInstructions: number;
  skippedThumbnailReferences: number;
}
