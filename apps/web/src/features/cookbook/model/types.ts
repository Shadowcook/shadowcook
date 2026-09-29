export interface IngredientUsage {
  sort_order: number;
  amount: string | null;
  unit_public_id: string | null;
  unit_symbol: string | null;
  unit_localization_key: string | null;
  ingredient_public_id: string | null;
  ingredient_name: string;
  ingredient_localization_key: string | null;
  is_catalog_ingredient: boolean;
  special_kind: string | null;
  note: string | null;
  is_optional: boolean;
}

export interface RecipeStep {
  public_id: string;
  sort_order: number;
  instruction: string;
  ingredients: IngredientUsage[];
}

export interface RecipeDetail {
  public_id: string;
  slug: string;
  title: string;
  summary: string | null;
  can_edit: boolean;
  can_share: boolean;
  selectedVariant: string;
  variants: RecipeVariant[];
  steps: RecipeStep[];
}
export interface RecipeVariant {
  variant_key: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_visible: boolean;
}

export interface Category {
  public_id: string;
  parent_public_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
}

export interface Recipe {
  public_id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_public_ids: string[];
}

export interface CookbookResponse {
  tenant: { display_name: string } | null;
  categories: Category[];
  recipes: Recipe[];
  canManageCategories: boolean;
  canManageRecipes: boolean;
  canManageUsers: boolean;
  canManageIngredients: boolean;
  canManageUnits: boolean;
}

export interface EditableRecipe {
  publicId: string;
  slug: string;
  title: string;
  summary: string | null;
  categoryPublicIds: string[];
  visibilityOverride: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC' | null;
  discoverabilityOverride: 'DISCOVERABLE' | 'UNLISTED' | null;
  effectiveVisibility: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC';
  effectiveDiscoverability: 'DISCOVERABLE' | 'UNLISTED';
  canChangeVisibility: boolean;
  publishedVersion: number | null;
  hasPublishedRevision: boolean;
  isDraft: boolean;
}
export interface CookbookTenant {
  public_id: string;
  display_name: string;
  description: string | null;
  slug: string;
  recipe_count: number;
  owner_name?: string | null;
  disabled_at: string | null;
}
