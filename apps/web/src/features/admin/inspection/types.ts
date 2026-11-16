export interface RevisionSummary {
  public_id: string;
  title: string;
  status: string;
  revision_no: number;
  published_at: string | null;
}
export interface InspectionOverview {
  cookbook: {
    public_id: string;
    display_name: string;
    slug: string;
    description: string | null;
    disabled_at: string | null;
    name_reset_required: boolean;
    created_at: string;
    updated_at: string;
    owner_public_id: string | null;
    owner_name: string | null;
  };
  counts: { recipes: number; members: number; reports: number };
}
export interface InspectionMember {
  public_id: string;
  display_name: string;
  roles: string[];
  joined_at: string;
}
export interface InspectionRecipe {
  public_id: string;
  slug: string;
  title: string | null;
  moderation_blocked_at: string | null;
  deleted_at: string | null;
}
export interface InspectionReport {
  public_id: string;
  status: string;
  created_at: string;
}
export interface InspectionPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface InspectionRevision {
  revision: RevisionSummary & { summary: string | null; created_at: string };
  categories: { public_id: string; name: string }[];
  variants: {
    variant_key: string;
    name: string;
    is_default: boolean;
    is_visible: boolean;
    step_keys: string[];
    diet: string | null;
    metadata: Record<string, string | number | null>;
  }[];
  steps: {
    step_key: string;
    instruction: string;
    ingredients: {
      name: string | null;
      amount: string | null;
      unit: string | null;
      note: string | null;
      special_kind: string | null;
      optional: boolean;
    }[];
  }[];
  media: { public_id: string }[];
}
