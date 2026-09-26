import { createHash } from 'node:crypto';
import type { Migration } from './types.js';

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

const sql: string = `
CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  description text,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  default_recipe_visibility text NOT NULL DEFAULT 'PUBLIC' CHECK (default_recipe_visibility IN ('PRIVATE', 'AUTHENTICATED', 'PUBLIC')),
  default_recipe_discoverability text NOT NULL DEFAULT 'DISCOVERABLE' CHECK (default_recipe_discoverability IN ('DISCOVERABLE', 'UNLISTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  ,disabled_at timestamptz
);

CREATE TABLE tenant_identity_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  public_key bytea NOT NULL,
  encrypted_private_key bytea NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key_id),
  UNIQUE (tenant_id, public_key)
);

CREATE TABLE tenant_federation_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  identity_key_id uuid NOT NULL REFERENCES tenant_identity_key(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  public_key bytea NOT NULL,
  encrypted_private_key bytea NOT NULL,
  delegation bytea NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key_id),
  UNIQUE (tenant_id, public_key),
  CHECK (valid_until > valid_from)
);

CREATE TABLE principal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type text NOT NULL CHECK (principal_type IN ('USER', 'SERVICE_ACCOUNT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL UNIQUE REFERENCES principal(id) ON DELETE RESTRICT,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  password_hash text,
  password_change_required boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL UNIQUE REFERENCES principal(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE permission (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]+(?:-[a-z]+)*(?::[a-z]+(?:-[a-z]+)*)+$'),
  description text NOT NULL
);

CREATE TABLE tenant_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (id, tenant_id)
);

CREATE TABLE tenant_role_permission (
  tenant_role_id uuid NOT NULL REFERENCES tenant_role(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permission(code) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_role_id, permission_code)
);

CREATE TABLE tenant_membership (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id)
);

CREATE TABLE tenant_membership_role (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  tenant_role_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, principal_id, tenant_role_id),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_membership(tenant_id, principal_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_role_id, tenant_id) REFERENCES tenant_role(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE instance_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z]+(?:-[a-z]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instance_role_permission (
  instance_role_id uuid NOT NULL REFERENCES instance_role(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permission(code) ON DELETE RESTRICT,
  PRIMARY KEY (instance_role_id, permission_code)
);

CREATE TABLE principal_instance_role (
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  instance_role_id uuid NOT NULL REFERENCES instance_role(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, instance_role_id)
);

CREATE TABLE user_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE TABLE api_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id uuid NOT NULL REFERENCES service_account(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  token_prefix text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_account_id, name)
);

CREATE TABLE instance_mail_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  smtp_host text NOT NULL CHECK (length(trim(smtp_host)) > 0),
  smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  transport_security text NOT NULL CHECK (transport_security IN ('STARTTLS', 'IMPLICIT_TLS')),
  username text,
  encrypted_password bytea,
  from_email text NOT NULL CHECK (length(trim(from_email)) > 0),
  from_name text NOT NULL CHECK (length(trim(from_name)) > 0),
  updated_by_principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((username IS NULL) = (encrypted_password IS NULL))
);

CREATE TABLE instance_authentication_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  login_mode text NOT NULL DEFAULT 'PASSWORD_OR_EMAIL_CODE' CHECK (login_mode IN ('PASSWORD_ONLY', 'EMAIL_CODE_ONLY', 'PASSWORD_OR_EMAIL_CODE')),
  updated_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_seed (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_one_time_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('LOGIN', 'TENANT_INVITATION')),
  code_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  max_failed_attempts integer NOT NULL DEFAULT 5 CHECK (max_failed_attempts > 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_ip inet,
  context_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_data) = 'object'),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX email_one_time_code_active_unique ON email_one_time_code(normalized_email, purpose) WHERE consumed_at IS NULL;
CREATE INDEX email_one_time_code_rate_email_idx ON email_one_time_code(normalized_email, purpose, created_at DESC);
CREATE INDEX email_one_time_code_rate_ip_idx ON email_one_time_code(requested_ip, purpose, created_at DESC);

CREATE TABLE ingredient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id uuid REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (length(trim(canonical_name)) > 0),
  localization_key text UNIQUE CHECK (localization_key IS NULL OR localization_key ~ '^ingredient\\.[a-z]+(?:\\.[a-z]+)*$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_tenant_id, canonical_name)
);

CREATE TABLE ingredient_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid REFERENCES ingredient(id) ON DELETE CASCADE,
  text_override text,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  alias text NOT NULL CHECK (length(trim(alias)) > 0),
  localization_key text UNIQUE CHECK (localization_key IS NULL OR localization_key ~ '^ingredient\\.[a-z]+(?:\\.[a-z]+)*$'),
  UNIQUE (ingredient_id, alias)
);

CREATE TABLE unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id uuid REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  symbol text NOT NULL CHECK (length(trim(symbol)) > 0),
  localization_key text UNIQUE CHECK (localization_key IS NULL OR localization_key ~ '^unit\\.[a-z]+(?:\\.[a-z]+)*$'),
  dimension text NOT NULL CHECK (dimension IN ('MASS', 'VOLUME', 'COUNT', 'TEMPERATURE')),
  base_factor numeric(24, 12) NOT NULL CHECK (base_factor > 0),
  base_offset numeric(24, 12) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_tenant_id, name),
  UNIQUE NULLS NOT DISTINCT (owner_tenant_id, symbol),
  CHECK (dimension = 'TEMPERATURE' OR base_offset = 0)
);

CREATE TABLE ingredient_modifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id uuid REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_tenant_id, name)
);

CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  parent_id uuid,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') CHECK (slug NOT IN ('admin', 'api', 'assets', 'auth', 'categories', 'health', 'login', 'logout', 'recipes', 'settings')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  UNIQUE NULLS NOT DISTINCT (tenant_id, parent_id, sort_order),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (parent_id, tenant_id) REFERENCES category(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE media_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum bytea NOT NULL,
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  lineage_public_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') CHECK (slug NOT IN ('admin', 'api', 'assets', 'auth', 'health', 'login', 'logout', 'recipes', 'settings')),
  visibility_override text CHECK (visibility_override IN ('PRIVATE', 'AUTHENTICATED', 'PUBLIC')),
  discoverability_override text CHECK (discoverability_override IN ('DISCOVERABLE', 'UNLISTED')),
  published_revision_id uuid,
  draft_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE recipe_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  summary text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (recipe_id, revision_no),
  UNIQUE (id, recipe_id),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);

ALTER TABLE recipe
  ADD CONSTRAINT recipe_published_revision_fk FOREIGN KEY (published_revision_id, id) REFERENCES recipe_revision(id, recipe_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT recipe_draft_revision_fk FOREIGN KEY (draft_revision_id, id) REFERENCES recipe_revision(id, recipe_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX recipe_one_draft_revision ON recipe_revision(recipe_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX recipe_one_published_revision ON recipe_revision(recipe_id) WHERE status = 'PUBLISHED';

CREATE TABLE recipe_revision_category (
  recipe_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_revision_id, category_id)
);

CREATE OR REPLACE FUNCTION assert_recipe_revision_has_category() RETURNS trigger AS $$
DECLARE
  target_recipe_revision_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'recipe_revision' THEN
    target_recipe_revision_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_recipe_revision_id := OLD.recipe_revision_id;
  ELSE
    target_recipe_revision_id := NEW.recipe_revision_id;
  END IF;
  IF EXISTS (SELECT 1 FROM recipe_revision WHERE id = target_recipe_revision_id AND status = 'PUBLISHED')
    AND NOT EXISTS (SELECT 1 FROM recipe_revision_category WHERE recipe_revision_id = target_recipe_revision_id) THEN
    RAISE EXCEPTION 'Every published recipe revision must have at least one category.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER recipe_revision_requires_category_on_revision
AFTER INSERT OR UPDATE OF status ON recipe_revision
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_recipe_revision_has_category();

CREATE CONSTRAINT TRIGGER recipe_revision_requires_category_on_assignment
AFTER INSERT OR DELETE ON recipe_revision_category
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_recipe_revision_has_category();

CREATE TABLE recipe_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  variant_key uuid NOT NULL,
  source_variant_id uuid REFERENCES recipe_variant(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (recipe_revision_id, variant_key),
  UNIQUE (recipe_revision_id, slug)
);

CREATE UNIQUE INDEX recipe_variant_one_default ON recipe_variant(recipe_revision_id) WHERE is_default;

CREATE TABLE recipe_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  step_key uuid NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  instruction text NOT NULL CHECK (length(trim(instruction)) > 0),
  UNIQUE (recipe_revision_id, step_key),
  UNIQUE (recipe_revision_id, sort_order)
);

CREATE TABLE recipe_variant_step_override (
  variant_id uuid NOT NULL REFERENCES recipe_variant(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES recipe_step(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('INCLUDE', 'EXCLUDE')),
  PRIMARY KEY (variant_id, step_id)
);

CREATE TABLE ingredient_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_step_id uuid NOT NULL REFERENCES recipe_step(id) ON DELETE CASCADE,
  usage_key uuid NOT NULL,
  ingredient_id uuid REFERENCES ingredient(id) ON DELETE CASCADE,
  text_override text,
  special_kind text CHECK (special_kind IN ('NO_ICON', 'REMOVE', 'ADD', 'INFO', 'IMPORTANT', 'COOK', 'COOL', 'HEAT', 'WAIT', 'WORK_STEP')),
  unit_id uuid REFERENCES unit(id) ON DELETE CASCADE,
  amount numeric(24, 12) CHECK (amount IS NULL OR amount >= 0),
  is_optional boolean NOT NULL DEFAULT false,
  note text,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  UNIQUE (recipe_step_id, usage_key),
  UNIQUE (recipe_step_id, sort_order),
  CHECK ((ingredient_id IS NOT NULL) <> (text_override IS NOT NULL)),
  CHECK (text_override IS NULL OR length(trim(text_override)) > 0),
  CHECK (special_kind IS NULL OR text_override IS NOT NULL),
  CHECK (special_kind IS NULL OR (amount IS NULL AND unit_id IS NULL AND is_optional = false))
);

CREATE TABLE ingredient_usage_modifier (
  ingredient_usage_id uuid NOT NULL REFERENCES ingredient_usage(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES ingredient_modifier(id) ON DELETE CASCADE,
  PRIMARY KEY (ingredient_usage_id, modifier_id)
);

CREATE TABLE recipe_revision_media (
  recipe_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_asset(id) ON DELETE CASCADE,
  usage_kind text NOT NULL CHECK (usage_kind IN ('COVER', 'INLINE')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (recipe_revision_id, media_asset_id),
  UNIQUE (recipe_revision_id, usage_kind, sort_order)
);

CREATE TABLE recipe_share_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  recipe_id uuid REFERENCES recipe(id) ON DELETE CASCADE,
  recipe_revision_id uuid REFERENCES recipe_revision(id) ON DELETE CASCADE,
  operation text NOT NULL,
  entity_type text NOT NULL,
  entity_key uuid,
  before_json jsonb,
  after_json jsonb,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cooking_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  draft_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  started_by_principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE cooking_session_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cooking_session_id uuid NOT NULL REFERENCES cooking_session(id) ON DELETE CASCADE,
  author_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(trim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_access_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  granting_tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  receiving_tenant_public_id uuid NOT NULL,
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (granting_tenant_id, receiving_tenant_public_id)
);

CREATE TABLE tenant_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  requested_permissions jsonb NOT NULL CHECK (jsonb_typeof(requested_permissions) = 'array'),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by_tenant_public_id uuid,
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((claimed_at IS NULL) = (claimed_by_tenant_public_id IS NULL))
);

CREATE TABLE tenant_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  first_name text NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name text NOT NULL CHECK (length(trim(last_name)) > 0),
  tenant_role_id uuid NOT NULL REFERENCES tenant_role(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by_principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX tenant_invitation_email_idx ON tenant_invitation(invited_email) WHERE accepted_at IS NULL;

CREATE TABLE recipe_upstream (
  recipe_id uuid PRIMARY KEY REFERENCES recipe(id) ON DELETE CASCADE,
  origin_tenant_public_id uuid NOT NULL,
  origin_recipe_public_id uuid NOT NULL,
  immediate_upstream_tenant_public_id uuid NOT NULL,
  immediate_upstream_recipe_public_id uuid NOT NULL,
  remote_instance_locator text NOT NULL,
  last_merged_remote_revision_public_id uuid,
  latest_known_remote_revision_public_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED', 'ACCESS_LOST', 'UNREACHABLE')),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE federation_entity_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  remote_tenant_public_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('INGREDIENT', 'UNIT', 'MODIFIER')),
  remote_entity_public_id uuid NOT NULL,
  local_entity_id uuid NOT NULL,
  mapping_source text NOT NULL CHECK (mapping_source IN ('MANUAL', 'AUTOMATIC')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (local_tenant_id, remote_tenant_public_id, entity_type, remote_entity_public_id)
);

CREATE INDEX category_tenant_parent_idx ON category(tenant_id, parent_id);
CREATE INDEX recipe_tenant_idx ON recipe(tenant_id);
CREATE INDEX recipe_revision_recipe_idx ON recipe_revision(recipe_id, revision_no DESC);
CREATE INDEX recipe_share_link_recipe_idx ON recipe_share_link(recipe_id) WHERE revoked_at IS NULL;
CREATE INDEX recipe_step_revision_idx ON recipe_step(recipe_revision_id, sort_order);
CREATE INDEX ingredient_usage_step_idx ON ingredient_usage(recipe_step_id, sort_order);
CREATE INDEX audit_event_tenant_created_idx ON audit_event(tenant_id, created_at DESC);
CREATE INDEX tenant_access_grant_receiver_idx ON tenant_access_grant(receiving_tenant_public_id);
CREATE INDEX user_session_user_account_idx ON user_session(user_account_id);
CREATE INDEX user_session_active_lookup_idx ON user_session(token_hash) WHERE revoked_at IS NULL;

INSERT INTO permission (code, description) VALUES
  ('instance:administer', 'Administer the Shadowcook instance.'),
  ('instance:mail-manage', 'Manage instance mail delivery settings.'),
  ('tenant:create', 'Create tenants and their initial owner invitations.'),
  ('tenant:manage', 'Manage tenant settings and memberships.'),
  ('recipe:read', 'Read tenant recipes.'),
  ('recipe:create', 'Create tenant recipes.'),
  ('recipe:update', 'Update tenant recipe drafts.'),
  ('recipe:delete', 'Delete tenant recipes.'),
  ('recipe:publish', 'Publish tenant recipe revisions.'),
  ('variant:read', 'Read recipe variants.'),
  ('variant:create', 'Create recipe variants.'),
  ('variant:update', 'Update recipe variants.'),
  ('variant:delete', 'Delete recipe variants.'),
  ('ingredient:read', 'Read tenant ingredients.'),
  ('ingredient:create', 'Create tenant ingredients.'),
  ('ingredient:update', 'Update tenant ingredients.'),
  ('category:read', 'Read tenant categories.'),
  ('category:update', 'Manage tenant categories.'),
  ('service-account:manage', 'Manage tenant service accounts.');

INSERT INTO instance_role (code, name) VALUES
  ('administrator', 'Administrator'),
  ('tenant-manager', 'Tenant manager');

INSERT INTO instance_role_permission (instance_role_id, permission_code)
SELECT instance_role.id, permission.code
FROM instance_role
CROSS JOIN permission
WHERE instance_role.code = 'administrator';

INSERT INTO instance_role_permission (instance_role_id, permission_code)
SELECT instance_role.id, permission.code FROM instance_role CROSS JOIN permission
WHERE instance_role.code = 'tenant-manager' AND permission.code = 'tenant:create';
`;

export const initialSchemaMigration: Migration = {
  id: '001_initial_schema',
  checksum: checksum(sql),
  sql,
};
