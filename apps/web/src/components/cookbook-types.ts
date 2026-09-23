export interface IngredientUsage {
  sort_order: number;
  amount: string | null;
  unit_symbol: string | null;
  ingredient_name: string;
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
  steps: RecipeStep[];
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
}
export interface CookbookTenant { public_id: string; display_name: string; description: string | null; slug: string; recipe_count: number; owner_name?: string | null; disabled_at: string | null; }
