-- Administrative management schema. Applied transactionally by the migration runner.

CREATE TABLE administrative_audit_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650)
);
INSERT INTO administrative_audit_policy (retention_days) VALUES (365);

-- Historical identities deliberately have no foreign keys to deletable resources.
CREATE TABLE administrative_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_principal_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^ADMIN_[A-Z0-9_]{1,100}$'),
  target_type text NOT NULL CHECK (target_type IN ('COOKBOOK', 'RECIPE', 'USER', 'INSTANCE', 'REPORT')),
  target_public_id uuid NOT NULL,
  cookbook_public_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  previous_state jsonb CHECK (jsonb_typeof(previous_state) = 'object' AND octet_length(previous_state::text) <= 4096),
  new_state jsonb CHECK (jsonb_typeof(new_state) = 'object' AND octet_length(new_state::text) <= 4096),
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  related_report_public_id uuid,
  outcome text NOT NULL CHECK (outcome = 'SUCCEEDED'),
  revision_public_id uuid,
  media_public_id uuid
);
CREATE INDEX administrative_audit_event_created_idx ON administrative_audit_event (created_at);
CREATE INDEX administrative_audit_event_target_idx ON administrative_audit_event (target_type, target_public_id, created_at);

ALTER TABLE recipe ADD COLUMN moderation_blocked_at timestamptz;
CREATE VIEW ordinary_recipe AS
  SELECT recipe.* FROM recipe
  WHERE moderation_blocked_at IS NULL
    AND EXISTS (SELECT 1 FROM tenant WHERE tenant.id = recipe.tenant_id
      AND tenant.disabled_at IS NULL AND NOT tenant.name_reset_required)
  WITH LOCAL CHECK OPTION;

CREATE TABLE administrative_email_recovery (
  user_account_id uuid PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
  actor_principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  new_email text NOT NULL CHECK (
    new_email = lower(trim(new_email)) AND length(new_email) BETWEEN 3 AND 254
  ),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  related_report_public_id uuid,
  CHECK (expires_at > created_at)
);

CREATE INDEX administrative_audit_event_report_idx
  ON administrative_audit_event (related_report_public_id, created_at DESC, id);

CREATE TABLE administrative_report_event (
  report_public_id uuid NOT NULL REFERENCES content_report(public_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES administrative_audit_event(id) ON DELETE CASCADE,
  PRIMARY KEY (report_public_id, event_id)
);

CREATE TABLE administrative_report_notice (
  public_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_public_id uuid NOT NULL REFERENCES content_report(public_id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES user_account(id),
  recipient_role text NOT NULL CHECK (recipient_role IN ('REPORTER', 'TARGET')),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
  review_instructions text NOT NULL CHECK (length(btrim(review_instructions)) BETWEEN 1 AND 2000),
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CHECK ((delivery_status = 'SENT') = (delivered_at IS NOT NULL))
);
CREATE INDEX administrative_report_notice_report_idx
  ON administrative_report_notice (report_public_id, created_at DESC, public_id);

ALTER TABLE instance_email_template DROP CONSTRAINT instance_email_template_template_key_check;
ALTER TABLE instance_email_template ADD CONSTRAINT instance_email_template_template_key_check
  CHECK (template_key IN (
    'CONTENT_REPORT', 'REGISTRATION_VERIFICATION', 'EMAIL_CHANGE_VERIFICATION', 'LOGIN_CODE',
    'PASSWORD_RESET', 'ADMIN_PASSWORD_RESET', 'INSTANCE_USER_INVITATION',
    'COOKBOOK_USER_INVITATION', 'COOKBOOK_OWNER_INVITATION', 'COOKBOOK_OWNERSHIP_TRANSFERRED',
    'ADMIN_EMAIL_RECOVERY_PROOF', 'ADMIN_EMAIL_RECOVERED', 'REPORT_DECISION_NOTICE',
    'RECIPE_RESTRICTED', 'COOKBOOK_RESTRICTED',
    'RECIPE_RESTRICTION_LIFTED', 'COOKBOOK_RESTRICTION_LIFTED',
    'RECIPE_DELETED', 'COOKBOOK_DELETED'
  ));
