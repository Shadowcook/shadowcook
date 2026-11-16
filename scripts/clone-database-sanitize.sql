-- Executed only in the disposable working database, in one transaction.
SET search_path = public, pg_catalog;
SET timezone = 'UTC';

CREATE TEMP TABLE clone_cleared_table (table_name text PRIMARY KEY);
INSERT INTO clone_cleared_table VALUES
  ('user_session'), ('password_reset_token'), ('email_one_time_code'),
  ('account_email_change'), ('administrative_email_recovery'), ('pending_registration'), ('registration_rate_event'),
  ('password_login_failure'), ('user_invitation'), ('tenant_invitation'),
  ('tenant_invite'), ('api_token'), ('ai_context_grant'),
  ('oauth_authorization_code'), ('oauth_access_token'), ('oauth_refresh_token'),
  ('oauth_client_redirect_uri'), ('oauth_client'), ('recipe_share_link'),
  ('tenant_access_grant'), ('tenant_federation_key'), ('tenant_identity_key'),
  ('instance_mail_settings');

-- This policy describes known data, not a required schema version. Missing
-- tables and columns need no cleanup. Unknown objects and columns are retained.
DELETE FROM clone_cleared_table policy
WHERE NOT EXISTS (
  SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = policy.table_name
    AND relation.relkind IN ('r', 'p')
);

CREATE TEMP TABLE clone_profile_column (
  column_name text PRIMARY KEY,
  replacement text NOT NULL,
  invalid_condition text NOT NULL
);
INSERT INTO clone_profile_column VALUES
  ('display_name', '''User '' || numbered.user_number::text', 'account.display_name !~ ''^User [0-9]+$'''),
  ('email', '''user'' || numbered.user_number::text || ''@local''', 'account.email !~ ''^user[0-9]+@local$'''),
  ('first_name', 'NULL', 'account.first_name IS NOT NULL'),
  ('last_name', 'NULL', 'account.last_name IS NOT NULL'),
  ('password_hash', 'NULL', 'account.password_hash IS NOT NULL'),
  ('password_change_required', 'false', 'account.password_change_required IS DISTINCT FROM false'),
  ('password_changed_at', 'NULL', 'account.password_changed_at IS NOT NULL');
UPDATE clone_profile_column policy
SET replacement = '''User '' || numbered.user_number::text',
  invalid_condition = format('account.%I !~ ''^User [0-9]+$''', policy.column_name)
WHERE policy.column_name IN ('first_name', 'last_name') AND EXISTS (
  SELECT 1 FROM pg_attribute attribute
  WHERE attribute.attrelid = to_regclass('public.user_account')
    AND attribute.attname = policy.column_name AND attribute.attnotnull
);
DELETE FROM clone_profile_column policy
WHERE NOT EXISTS (
  SELECT 1 FROM pg_attribute attribute
  WHERE attribute.attrelid = to_regclass('public.user_account')
    AND attribute.attname = policy.column_name
    AND attribute.attnum > 0 AND NOT attribute.attisdropped AND attribute.attgenerated = ''
    -- Non-nullable password fields are overwritten by password setup in staging.
    AND (policy.replacement <> 'NULL' OR NOT attribute.attnotnull)
);

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
    WHEN 'user_account' THEN ARRAY(SELECT column_name FROM clone_profile_column)
    WHEN 'instance_report_settings' THEN ARRAY['recipient_email']::text[]
    ELSE ARRAY[]::text[]
  END AS omitted_columns,
  NULL::text AS fingerprint
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM clone_cleared_table cleared WHERE cleared.table_name = c.relname);
UPDATE clone_retained_table
SET fingerprint = pg_temp.clone_fingerprint(relation, omitted_columns);

DO $$
DECLARE
  temporary_prefix text;
  assignments text;
  ordering text;
BEGIN
  IF EXISTS (SELECT 1 FROM clone_profile_column WHERE column_name = 'email') THEN
    LOOP
      temporary_prefix := 'clone-' || gen_random_uuid()::text || '-';
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_account WHERE starts_with(email, temporary_prefix));
    END LOOP;
    -- First move all addresses out of the destination namespace to avoid unique
    -- collisions. Numbering uses the copied columns, with ctid as a fallback.
    EXECUTE 'UPDATE public.user_account SET email = $1 || gen_random_uuid()::text || ''@local'''
      USING temporary_prefix;
  END IF;
  SELECT string_agg(format('%I = %s', column_name, replacement), ', ' ORDER BY column_name)
    INTO assignments FROM clone_profile_column;
  IF assignments IS NOT NULL THEN
    SELECT string_agg(format('%I', attname), ', ' ORDER BY CASE attname WHEN 'created_at' THEN 1 ELSE 2 END)
      INTO ordering FROM pg_attribute
      WHERE attrelid = to_regclass('public.user_account') AND attname IN ('created_at', 'id')
        AND attnum > 0 AND NOT attisdropped;
    EXECUTE format(
      'WITH numbered AS MATERIALIZED (
         SELECT tableoid AS row_table, ctid AS row_location,
           row_number() OVER (ORDER BY %s) AS user_number FROM public.user_account
       ) UPDATE public.user_account account SET %s FROM numbered
         WHERE account.tableoid = numbered.row_table AND account.ctid = numbered.row_location',
      coalesce(ordering, 'tableoid, ctid'), assignments
    );
  END IF;
END;
$$;

-- DELETE without CASCADE: unrecognized dependencies must never silently erase
-- retained business data. Deferred constraints are checked when this commits.
DO $$
DECLARE
  cleared record;
  recipient_required boolean;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  FOR cleared IN SELECT table_name FROM clone_cleared_table LOOP
    EXECUTE format('DELETE FROM public.%I', cleared.table_name);
  END LOOP;
  SELECT attnotnull INTO recipient_required
    FROM pg_attribute WHERE attrelid = to_regclass('public.instance_report_settings')
      AND attname = 'recipient_email' AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
  IF FOUND THEN
    EXECUTE 'UPDATE public.instance_report_settings SET recipient_email = '
      || CASE WHEN recipient_required THEN quote_literal('reports@local') ELSE 'NULL' END;
  END IF;
END;
$$;

DO $$
DECLARE
  retained record;
  cleared record;
  remaining bigint;
  invalid_profile text;
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
  SELECT string_agg('(' || invalid_condition || ')', ' OR ') INTO invalid_profile FROM clone_profile_column;
  IF invalid_profile IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.user_account account WHERE ' || invalid_profile INTO remaining;
    IF remaining <> 0 THEN
      RAISE EXCEPTION 'Profile sanitization is incomplete.';
    END IF;
  END IF;
END;
$$;
