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
  target_type text NOT NULL CHECK (target_type IN ('COOKBOOK', 'RECIPE', 'USER', 'INSTANCE')),
  target_public_id uuid NOT NULL,
  cookbook_public_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  previous_state jsonb CHECK (jsonb_typeof(previous_state) = 'object' AND octet_length(previous_state::text) <= 4096),
  new_state jsonb CHECK (jsonb_typeof(new_state) = 'object' AND octet_length(new_state::text) <= 4096),
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  related_report_public_id uuid,
  outcome text NOT NULL CHECK (outcome = 'SUCCEEDED')
);
CREATE INDEX administrative_audit_event_created_idx ON administrative_audit_event (created_at);
CREATE INDEX administrative_audit_event_target_idx ON administrative_audit_event (target_type, target_public_id, created_at);
