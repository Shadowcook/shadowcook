-- Executed only in the disposable working database, in one transaction.
SET search_path = public, pg_catalog;
SET timezone = 'UTC';

CREATE TEMP TABLE clone_cleared_table (table_name text PRIMARY KEY);
INSERT INTO clone_cleared_table VALUES
  ('user_session'), ('password_reset_token'), ('email_one_time_code'),
  ('account_email_change'), ('pending_registration'), ('registration_rate_event'),
  ('password_login_failure'), ('user_invitation'), ('tenant_invitation'),
  ('tenant_invite'), ('api_token'), ('ai_context_grant'),
  ('oauth_authorization_code'), ('oauth_access_token'), ('oauth_refresh_token'),
  ('oauth_client_redirect_uri'), ('oauth_client'), ('recipe_share_link'),
  ('tenant_access_grant'), ('tenant_federation_key'), ('tenant_identity_key'),
  ('instance_mail_settings');

-- Refuse unknown profile fields rather than accidentally copying new contact
-- details introduced by a version this deployment tool does not understand.
DO $$
DECLARE
  actual_columns text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY column_name)
    INTO actual_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_account';
  IF actual_columns IS DISTINCT FROM ARRAY[
    'created_at', 'deleted_at', 'disabled_at', 'display_name', 'email',
    'first_name', 'id', 'last_login_at', 'last_name', 'password_change_required',
    'password_changed_at', 'password_hash', 'principal_id', 'public_id', 'updated_at'
  ]::text[] THEN
    RAISE EXCEPTION 'Unsupported user_account schema. Update the clone sanitization policy.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_'
  ) THEN
    RAISE EXCEPTION 'Only a dedicated Shadowcook database with application objects in public is supported.';
  END IF;
END;
$$;

-- Verify every retained table, including future business tables. Profile and
-- recipient fields are the only retained-row exceptions. No timestamps change.
CREATE FUNCTION pg_temp.clone_fingerprint(relation regclass, omitted_columns text[])
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  result text;
BEGIN
  EXECUTE format(
    'SELECT count(*)::text || '':'' || md5(coalesce(string_agg(row_hash, '''' ORDER BY row_hash), ''''))
     FROM (SELECT md5((to_jsonb(row_value) - $1)::text) AS row_hash FROM %s row_value) rows',
    relation
  ) INTO result USING omitted_columns;
  RETURN result;
END;
$$;

CREATE TEMP TABLE clone_retained_table AS
SELECT c.oid::regclass AS relation,
  CASE c.relname
    WHEN 'user_account' THEN ARRAY[
      'display_name', 'email', 'first_name', 'last_name', 'password_hash',
      'password_change_required', 'password_changed_at'
    ]::text[]
    WHEN 'instance_report_settings' THEN ARRAY['recipient_email']::text[]
    ELSE ARRAY[]::text[]
  END AS omitted_columns,
  NULL::text AS fingerprint
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM clone_cleared_table cleared WHERE cleared.table_name = c.relname);

UPDATE clone_retained_table
SET fingerprint = pg_temp.clone_fingerprint(relation, omitted_columns);

CREATE TEMP TABLE clone_user_number AS
SELECT id, row_number() OVER (ORDER BY created_at, id) AS user_number FROM user_account;

-- A temporary namespace avoids transient unique-email collisions, for example
-- when an existing production address is already user1@local.
DO $$
DECLARE
  temporary_prefix text;
BEGIN
  LOOP
    temporary_prefix := 'clone-' || gen_random_uuid()::text || '-';
    EXIT WHEN NOT EXISTS (SELECT 1 FROM user_account WHERE starts_with(email, temporary_prefix));
  END LOOP;
  UPDATE user_account SET email = temporary_prefix || id::text || '@local';
END;
$$;

UPDATE user_account account SET
  display_name = 'User ' || numbered.user_number::text,
  email = 'user' || numbered.user_number::text || '@local',
  first_name = NULL,
  last_name = NULL,
  password_hash = NULL,
  password_change_required = false,
  password_changed_at = NULL
FROM clone_user_number numbered WHERE numbered.id = account.id;

-- DELETE without CASCADE: new foreign-key dependencies must cause an error,
-- never silently delete business records.
DO $$
DECLARE
  cleared record;
BEGIN
  FOR cleared IN SELECT table_name FROM clone_cleared_table LOOP
    EXECUTE format('DELETE FROM public.%I', cleared.table_name);
  END LOOP;
END;
$$;

UPDATE instance_report_settings SET recipient_email = NULL;

DO $$
DECLARE
  retained record;
  cleared record;
  remaining bigint;
BEGIN
  FOR retained IN SELECT * FROM clone_retained_table LOOP
    IF retained.fingerprint IS DISTINCT FROM
      pg_temp.clone_fingerprint(retained.relation, retained.omitted_columns) THEN
      RAISE EXCEPTION 'Business data changed in %; refusing to publish the copy.', retained.relation;
    END IF;
  END LOOP;
  FOR cleared IN SELECT table_name FROM clone_cleared_table LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', cleared.table_name) INTO remaining;
    IF remaining <> 0 THEN
      RAISE EXCEPTION 'Operational credentials or delivery settings remain in %.', cleared.table_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM user_account account JOIN clone_user_number numbered USING (id)
    WHERE account.display_name <> 'User ' || numbered.user_number::text
      OR account.email <> 'user' || numbered.user_number::text || '@local'
      OR account.first_name IS NOT NULL OR account.last_name IS NOT NULL
      OR account.password_hash IS NOT NULL OR account.password_change_required
      OR account.password_changed_at IS NOT NULL
  ) OR EXISTS (SELECT 1 FROM instance_report_settings WHERE recipient_email IS NOT NULL) THEN
    RAISE EXCEPTION 'Profile or mail sanitization is incomplete.';
  END IF;
END;
$$;
