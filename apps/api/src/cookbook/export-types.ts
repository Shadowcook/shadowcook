import type { RecipeContentMetadata, RecipeDiet } from './recipe-facts.js';
import type { ExportImportSources } from './export-import-sources.js';

export interface ExportCookbookSettings {
  public_id: string;
  display_name: string;
  description: string | null;
  slug: string;
  default_recipe_visibility: string;
  default_recipe_discoverability: string;
  frontpage_recipe_count: number;
  frontpage_heading: string | null;
  show_on_start_page: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExportCategory {
  public_id: string;
  parent_public_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
}

export interface ExportIngredient {
  public_id: string;
  canonical_name: string;
}

export interface ExportIngredientAlias {
  public_id: string;
  ingredient_public_id: string;
  alias: string;
}

export interface ExportUnit {
  public_id: string;
  is_instance_owned: boolean;
  name: string;
  symbol: string;
  localization_key: string | null;
  dimension: string | null;
  base_factor: string | null;
  base_offset: string | null;
  translations: Record<string, { name: string; symbol: string }>;
}

export interface ExportRecipe {
  public_id: string;
  lineage_public_id: string;
  slug: string;
  visibility_override: string | null;
  discoverability_override: string | null;
  is_featured: boolean;
  published_revision_public_id: string | null;
  draft_revision_public_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportRevision {
  metadata: RecipeContentMetadata;
  diet: RecipeDiet | null;
  public_id: string;
  recipe_public_id: string;
  revision_no: number;
  status: string;
  title: string;
  summary: string | null;
  version: number;
  author_display_name: string | null;
  contributor_display_names: string[];
  created_at: string;
  published_at: string | null;
  category_public_ids: string[];
}

export interface ExportVariant {
  revision_public_id: string;
  variant_key: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_visible: boolean;
  included_step_keys: string[];
}

export interface ExportStep {
  revision_public_id: string;
  step_key: string;
  sort_order: number;
  instruction: string;
}

export interface ExportIngredientUsage {
  revision_public_id: string;
  step_key: string;
  usage_key: string;
  ingredient_public_id: string | null;
  ingredient_alias_public_id: string | null;
  text_override: string | null;
  special_kind: string | null;
  unit_public_id: string | null;
  amount: string | null;
  is_optional: boolean;
  note: string | null;
  sort_order: number;
}

export interface CookbookExport {
  import_sources: ExportImportSources;
  format: 'shadowcook-cookbook';
  format_version: 1;
  exported_at: string;
  cookbook: ExportCookbookSettings;
  categories: ExportCategory[];
  ingredients: ExportIngredient[];
  ingredient_aliases: ExportIngredientAlias[];
  units: ExportUnit[];
  recipes: ExportRecipe[];
  revisions: ExportRevision[];
  variants: ExportVariant[];
  steps: ExportStep[];
  ingredient_usages: ExportIngredientUsage[];
}
