import type { ColumnType, Generated } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Uuid = ColumnType<string, string | undefined, string>;

export interface TenantTable {
  id: Generated<Uuid>;
  public_id: Generated<Uuid>;
  display_name: string;
  description: string | null;
  slug: string;
  default_recipe_visibility: 'PRIVATE' | 'AUTHENTICATED' | 'PUBLIC';
  default_recipe_discoverability: 'DISCOVERABLE' | 'UNLISTED';
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
}

export interface UserSessionTable {
  id: Generated<Uuid>;
  user_account_id: string;
  token_hash: Buffer;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface RecipeTable {
  id: Generated<Uuid>;
  tenant_id: string;
  public_id: Generated<Uuid>;
  lineage_public_id: string;
  slug: string;
  visibility_override: 'PRIVATE' | 'AUTHENTICATED' | 'PUBLIC' | null;
  discoverability_override: 'DISCOVERABLE' | 'UNLISTED' | null;
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

/**
 * The complete database contains additional domain tables created by the
 * initial migration. These core tables are typed now because they are the
 * first persistence boundary used by the API.
 */
export interface Database {
  tenant: TenantTable;
  user_account: UserAccountTable;
  user_session: UserSessionTable;
  recipe: RecipeTable;
  recipe_revision: RecipeRevisionTable;
}
