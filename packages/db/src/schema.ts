import type { ColumnType, Generated } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Uuid = ColumnType<string, string | undefined, string>;

export interface TenantTable {
  id: Generated<Uuid>;
  public_id: Generated<Uuid>;
  display_name: string;
  description: string | null;
  slug: string;
  default_recipe_visibility: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC';
  default_recipe_discoverability: 'DISCOVERABLE' | 'UNLISTED';
  show_on_start_page: Generated<boolean>;
  frontpage_recipe_count: Generated<number>;
  frontpage_heading: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface InstanceFrontpageSettingsTable {
  singleton: Generated<boolean>;
  site_name: string;
  slogan: string;
  cookbooks_per_page: number;
  updated_by_principal_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface InstanceLegalDocumentsTable {
  singleton: Generated<boolean>;
  privacy_statement_markdown: string;
  imprint_markdown: string;
  updated_by_principal_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserAccountTable {
  id: Generated<Uuid>;
  principal_id: string;
  public_id: Generated<Uuid>;
  email: string;
  display_name: string;
  password_hash: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  password_change_required: Generated<boolean>;
  password_changed_at: Timestamp | null;
  last_login_at: Timestamp | null;
  disabled_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface UserSessionTable {
  id: Generated<Uuid>;
  user_account_id: string;
  token_hash: Buffer;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  revoked_at: Timestamp | null;
  frontpage_shuffle_seed: string | null;
}

export interface PasswordResetTokenTable {
  id: Generated<Uuid>;
  user_account_id: string;
  token_hash: Buffer;
  force_password_change: Generated<boolean>;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface PendingRegistrationTable {
  id: Generated<Uuid>;
  email: string;
  password_hash: string;
  tenant_name: string;
  verification_token_hash: Buffer;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
}

export interface RegistrationRateEventTable {
  id: Generated<Uuid>;
  event_type: 'REGISTRATION' | 'VERIFICATION_RESEND';
  requested_ip: string | null;
  normalized_email: string | null;
  created_at: Generated<Timestamp>;
}

export interface InstanceRegistrationSettingsTable {
  singleton: Generated<boolean>;
  enabled: Generated<boolean>;
  turnstile_enabled: Generated<boolean>;
  updated_by_principal_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserInvitationTable {
  id: Generated<Uuid>;
  tenant_id: string | null;
  tenant_role_id: string | null;
  instance_role_id: string | null;
  invited_email: string;
  token_hash: Buffer;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  created_by_principal_id: string;
  created_at: Generated<Timestamp>;
}

export interface RecipeTable {
  id: Generated<Uuid>;
  tenant_id: string;
  public_id: Generated<Uuid>;
  lineage_public_id: string;
  slug: string;
  visibility_override: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC' | null;
  discoverability_override: 'DISCOVERABLE' | 'UNLISTED' | null;
  is_featured: Generated<boolean>;
  published_revision_id: string | null;
  draft_revision_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RecipeRevisionTable {
  id: Generated<Uuid>;
  recipe_id: string;
  public_id: Generated<Uuid>;
  revision_no: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  title: string;
  summary: string | null;
  version: Generated<number>;
  created_by_principal_id: string | null;
  created_at: Generated<Timestamp>;
  published_at: Timestamp | null;
}

export interface RecipeShareLinkTable {
  id: Generated<Uuid>;
  recipe_id: string;
  name: string | null;
  token: string;
  token_hash: Buffer;
  created_by_principal_id: string | null;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface AiContextGrantTable {
  id: Generated<Uuid>;
  tenant_id: string;
  created_by_principal_id: string;
  scope_type: 'TENANT' | 'RECIPE' | 'CATEGORY';
  scope_public_id: string;
  bootstrap_token_hash: Buffer;
  bootstrap_expires_at: Timestamp;
  bootstrap_consumed_at: Timestamp | null;
  access_token_hash: Buffer | null;
  expires_at: Timestamp;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface UnitTable {
  id: Generated<Uuid>;
  owner_tenant_id: string | null;
  public_id: Generated<Uuid>;
  name: string;
  symbol: string;
  localization_key: string | null;
  dimension: 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';
  base_factor: string;
  base_offset: string;
  created_at: Generated<Timestamp>;
}

export interface IngredientTable {
  id: Generated<Uuid>;
  owner_tenant_id: string | null;
  public_id: Generated<Uuid>;
  canonical_name: string;
  localization_key: string | null;
  created_at: Generated<Timestamp>;
}

export interface IngredientAliasTable {
  id: Generated<Uuid>;
  ingredient_id: string;
  public_id: Generated<Uuid>;
  alias: string;
  localization_key: string | null;
}

export interface ApplicationSeedTable {
  id: string;
  applied_at: Generated<Timestamp>;
}

/**
 * The complete database contains additional domain tables created by the
 * initial migration. These core tables are typed now because they are the
 * first persistence boundary used by the API.
 */
export interface Database {
  instance_frontpage_settings: InstanceFrontpageSettingsTable;
  instance_legal_documents: InstanceLegalDocumentsTable;
  tenant: TenantTable;
  user_account: UserAccountTable;
  user_session: UserSessionTable;
  password_reset_token: PasswordResetTokenTable;
  pending_registration: PendingRegistrationTable;
  registration_rate_event: RegistrationRateEventTable;
  instance_registration_settings: InstanceRegistrationSettingsTable;
  user_invitation: UserInvitationTable;
  recipe: RecipeTable;
  recipe_revision: RecipeRevisionTable;
  recipe_share_link: RecipeShareLinkTable;
  ai_context_grant: AiContextGrantTable;
  unit: UnitTable;
  ingredient: IngredientTable;
  ingredient_alias: IngredientAliasTable;
  application_seed: ApplicationSeedTable;
}
