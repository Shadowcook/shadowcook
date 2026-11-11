#!/usr/bin/env bash

# Integration tests use a disposable local cluster, private Unix socket, and no
# TCP listener. No deployment environment or existing PostgreSQL is accessed.
set -euo pipefail
umask 077
export TZ=UTC
repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
postgres_bin=$(pg_config --bindir)
export PATH="${postgres_bin}:${PATH}"
test_directory=$(mktemp -d /tmp/shadowcook-clone-test.XXXXXXXX)
cluster_started=false
client_pid=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "${client_pid}" ]]; then
    kill "${client_pid}" 2>/dev/null || true
    wait "${client_pid}" 2>/dev/null || true
  fi
  if [[ "${cluster_started}" == true ]]; then
    pg_ctl -D "${test_directory}/cluster" -m immediate -w stop > /dev/null
  fi
  if [[ "${result}" == 0 ]]; then
    rm -rf -- "${test_directory}"
  else
    printf 'Test diagnostics: %s\n' "${test_directory}" >&2
  fi
  exit "${result}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
initdb -D "${test_directory}/cluster" -A trust -U clone_test > "${test_directory}/initdb.log"
pg_ctl -D "${test_directory}/cluster" -l "${test_directory}/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='${test_directory}' -c fsync=off" -w start > /dev/null
cluster_started=true
unset PGDATABASE PGHOST PGPORT PGUSER PGPASSWORD PGSERVICE PGOPTIONS PGPASSFILE
export PGHOST="${test_directory}" PGUSER=clone_test PGDATABASE=postgres
createdb clone_source
createdb clone_target
psql -X -v ON_ERROR_STOP=1 -d clone_source \
  -f "${repository_root}/packages/db/src/migrations/sql/20261030204936_initial_schema.sql" \
  > "${test_directory}/schema.log"
psql -X -v ON_ERROR_STOP=1 -d clone_source > "${test_directory}/seed.log" <<'SQL'
CREATE ROLE clone_reader LOGIN;
GRANT CONNECT ON DATABASE clone_source TO clone_reader;
GRANT USAGE ON SCHEMA public TO clone_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clone_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO clone_reader;
ALTER ROLE clone_reader SET default_transaction_read_only = on;
INSERT INTO principal (id, principal_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'USER'),
  ('00000000-0000-0000-0000-000000000002', 'USER'),
  ('00000000-0000-0000-0000-000000000003', 'USER');
INSERT INTO principal_instance_role (principal_id, instance_role_id)
  SELECT '00000000-0000-0000-0000-000000000001', id FROM instance_role WHERE code = 'administrator';
INSERT INTO user_account
  (id, principal_id, email, display_name, first_name, last_name, password_hash, created_at, deleted_at, disabled_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'real@example.com', 'Real Person', 'Real', 'Person', 'production-hash', '2026-01-01', NULL, NULL),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'user1@local', 'Collision', 'Another', 'Person', 'another-hash', '2026-01-02', NULL, now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'real@example.com', 'Deleted', NULL, NULL, 'old-hash', '2026-01-03', now(), now());
INSERT INTO tenant (id, display_name, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Real Person cookbook', 'real-person');
INSERT INTO tenant_membership (tenant_id, principal_id)
  SELECT '00000000-0000-0000-0000-000000000001', id FROM principal;
UPDATE tenant SET owner_principal_id = '00000000-0000-0000-0000-000000000001';
INSERT INTO recipe (id, tenant_id, lineage_public_id, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'real-recipe');
INSERT INTO recipe_revision (id, recipe_id, revision_no, status, title, summary, created_by_principal_id) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1, 'DRAFT', 'Grandma Real Person recipe', 'Contact real@example.com, unchanged content', '00000000-0000-0000-0000-000000000001');
UPDATE recipe SET draft_revision_id = '00000000-0000-0000-0000-000000000001';
INSERT INTO recipe_revision_contributor SELECT id, created_by_principal_id FROM recipe_revision;
INSERT INTO audit_event (tenant_id, principal_id, operation, entity_type, after_json)
  SELECT id, owner_principal_id, 'CREATE', 'TENANT', '{"name":"Real Person", "email":"real@example.com"}'::jsonb FROM tenant;
INSERT INTO content_report (reporter_user_id, target_type, target_public_id, reason, description)
  SELECT id, 'USER', public_id, 'OTHER', 'Real Person at real@example.com' FROM user_account LIMIT 1;
INSERT INTO content_report_notification (report_public_id) SELECT public_id FROM content_report;
UPDATE instance_report_settings SET recipient_email = 'admin@production.example';
INSERT INTO instance_mail_settings (smtp_host, smtp_port, transport_security, username, encrypted_password, from_email, from_name, updated_by_principal_id)
  VALUES ('smtp.production.example', 587, 'STARTTLS', 'production-user', '\x1234', 'admin@production.example', 'Production', '00000000-0000-0000-0000-000000000001');
INSERT INTO user_session (user_account_id, token_hash, expires_at)
  SELECT id, decode(md5(id::text), 'hex'), now() + interval '1 day' FROM user_account;
INSERT INTO password_reset_token (user_account_id, token_hash, expires_at)
  SELECT id, decode(md5(id::text), 'hex'), now() + interval '1 day' FROM user_account;
INSERT INTO pending_registration (email, password_hash, verification_token_hash, expires_at)
  VALUES ('pending@production.example', 'pending-hash', '\x1234', now() + interval '1 day');
INSERT INTO recipe_share_link (recipe_id, token, token_hash)
  SELECT id, 'production-share', '\x1234' FROM recipe;
INSERT INTO account_email_change (user_account_id, new_email, token_hash, expires_at, last_sent_at, send_count)
  SELECT id, 'changed@production.example', decode(repeat('ab', 32), 'hex'), now() + interval '1 day', now(), 1 FROM user_account LIMIT 1;
INSERT INTO email_one_time_code (normalized_email, purpose, code_hash, expires_at, requested_ip)
  VALUES ('real@example.com', 'LOGIN', '\x1234', now() + interval '1 day', '192.0.2.1');
INSERT INTO password_login_failure (client_ip) VALUES ('192.0.2.1');
INSERT INTO registration_rate_event (event_type, requested_ip, normalized_email)
  VALUES ('REGISTRATION', '192.0.2.1', 'real@example.com');
INSERT INTO principal (id, principal_type) VALUES ('00000000-0000-0000-0000-000000000004', 'SERVICE_ACCOUNT');
INSERT INTO service_account (id, principal_id, tenant_id, name)
  VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Production integration');
INSERT INTO api_token (service_account_id, name, token_prefix, token_hash)
  SELECT id, 'Production token', 'prod', '\x1234' FROM service_account;
INSERT INTO oauth_client (id, client_id, client_name)
  VALUES ('00000000-0000-0000-0000-000000000001', 'production-client', 'Production client');
INSERT INTO oauth_client_redirect_uri SELECT id, 'https://production.example/callback' FROM oauth_client;
INSERT INTO oauth_access_token (token_hash, principal_id, client_id, resource, scope, expires_at)
  VALUES ('\x1234', '00000000-0000-0000-0000-000000000001', 'production-client', 'https://production.example', 'read', now() + interval '1 day');
INSERT INTO ai_context_grant (tenant_id, created_by_principal_id, scope_type, scope_public_id, bootstrap_token_hash, bootstrap_expires_at, expires_at)
  SELECT id, owner_principal_id, 'TENANT', public_id, '\x1234', now() + interval '1 hour', now() + interval '1 day' FROM tenant;
-- A table unknown to the clone policy must also remain intact.
CREATE TABLE future_business_data (id integer PRIMARY KEY, value jsonb);
INSERT INTO future_business_data VALUES (1, '{"email":"business@example.com", "number":1.250}');
GRANT SELECT ON future_business_data TO clone_reader;
SQL

socket_host="${test_directory//\//%2F}"
source_url="postgresql://clone_reader@${socket_host}/clone_source"
target_url="postgresql://clone_test@${socket_host}/clone_target"
environment_file="${test_directory}/.env.db-clone"
write_environment() {
  printf "SOURCE_DATABASE_URL='%s'\nTARGET_DATABASE_URL='%s'\n" "$1" "$2" > "${environment_file}"
}
clone_script="${repository_root}/scripts/clone-database.sh"
run_clone() {
  printf '%s\n' 'eR7!vQ2#nL9@xC4$kM8%pT6&zA1*' \
    | bash "${clone_script}" --admin-password-stdin "$@"
}
write_environment "${source_url}" "${target_url}"
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'CREATE TABLE target_sentinel (value text); INSERT INTO target_sentinel VALUES ('\''keep until success'\'');' > /dev/null
run_clone --env-file "${environment_file}"
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
printf 'PASS: validation does not modify the target\n'

# Keep a real target connection open, with a readiness file written by psql.
psql -X -q -d clone_target > "${test_directory}/active-client.log" <<SQL &
\o ${test_directory}/client-ready
SELECT 1;
\o
SELECT pg_sleep(60);
SQL
client_pid=$!
for ((attempt = 0; attempt < 100; attempt++)); do
  [[ ! -s "${test_directory}/client-ready" ]] || break
  sleep 0.05
done
[[ -s "${test_directory}/client-ready" ]]
if run_clone --env-file "${environment_file}" --execute > "${test_directory}/active-target.log" 2>&1; then
  printf 'FAIL: active target connection was accepted\n' >&2
  exit 1
fi
# Terminate only the session started by this test, within its private cluster.
psql -X -q -d clone_source -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'clone_target'" > /dev/null
wait "${client_pid}" 2>/dev/null || true
client_pid=''
printf 'PASS: active target clients are rejected\n'

write_environment "${source_url}" "postgresql://clone_test@${socket_host}/clone_source?application_name=alias"
if run_clone --env-file "${environment_file}" --execute > "${test_directory}/same-database.log" 2>&1; then
  printf 'FAIL: same-database alias was accepted\n' >&2
  exit 1
fi
write_environment "${source_url}" "${target_url}"

# A new contact column must fail in staging and leave the target untouched.
psql -X -v ON_ERROR_STOP=1 -d clone_source -c 'ALTER TABLE user_account ADD COLUMN phone text' > /dev/null
if TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute > "${test_directory}/unsupported-schema.log" 2>&1; then
  printf 'FAIL: unknown profile field was accepted\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_source -c 'ALTER TABLE user_account DROP COLUMN phone' > /dev/null
printf 'PASS: aliases rejected; sanitization failure preserves target and cleans staging\n'

TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute
psql -X -v ON_ERROR_STOP=1 -d clone_target > "${test_directory}/assertions.log" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM user_account) <> 4 OR EXISTS (
    SELECT 1 FROM user_account WHERE email <> 'admin@local' AND (display_name <> 'User ' || right(id::text, 1)
      OR email <> 'user' || right(id::text, 1) || '@local'
      OR password_hash IS NULL OR password_changed_at IS NULL OR password_change_required
      OR first_name IS NOT NULL OR last_name IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Profile sanitization failed'; END IF;
  IF EXISTS (SELECT 1 FROM user_session) OR EXISTS (SELECT 1 FROM password_reset_token)
    OR EXISTS (SELECT 1 FROM pending_registration) OR EXISTS (SELECT 1 FROM recipe_share_link)
    OR EXISTS (SELECT 1 FROM instance_mail_settings)
    OR EXISTS (SELECT 1 FROM account_email_change) OR EXISTS (SELECT 1 FROM email_one_time_code)
    OR EXISTS (SELECT 1 FROM api_token) OR EXISTS (SELECT 1 FROM oauth_client)
    OR EXISTS (SELECT 1 FROM oauth_access_token) OR EXISTS (SELECT 1 FROM ai_context_grant)
    OR EXISTS (SELECT 1 FROM password_login_failure) OR EXISTS (SELECT 1 FROM registration_rate_event)
    OR EXISTS (SELECT 1 FROM instance_report_settings WHERE recipient_email IS NOT NULL)
  THEN RAISE EXCEPTION 'Production access or mail settings survived'; END IF;
  IF to_regclass('target_sentinel') IS NOT NULL THEN RAISE EXCEPTION 'Stale target table survived'; END IF;
END;
$$;
SQL

# Compare complete SQL data exports of every retained table across databases,
# excluding only the two tables with intentional field updates.
while IFS= read -r table_name; do
  pg_dump -d clone_source --data-only --table="public.${table_name}" --no-owner --no-acl \
    | sed '/^\\restrict /d; /^\\unrestrict /d' > "${test_directory}/source-table.sql"
  pg_dump -d clone_target --data-only --table="public.${table_name}" --no-owner --no-acl \
    | sed '/^\\restrict /d; /^\\unrestrict /d' > "${test_directory}/target-table.sql"
  diff -u "${test_directory}/source-table.sql" "${test_directory}/target-table.sql"
done < <(psql -X -At -d clone_source -c "
  SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('user_account', 'principal', 'principal_instance_role', 'instance_report_settings', 'user_session',
      'password_reset_token', 'pending_registration', 'recipe_share_link', 'instance_mail_settings',
      'account_email_change', 'email_one_time_code', 'password_login_failure', 'registration_rate_event',
      'api_token', 'oauth_client', 'oauth_client_redirect_uri', 'oauth_access_token', 'ai_context_grant')
  ORDER BY tablename")
[[ "$(psql -X -At -d clone_source -c "SELECT email FROM user_account ORDER BY created_at LIMIT 1")" == real@example.com ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
printf 'PASS: profiles, invalid credentials, unchanged business data, untouched source, stale target removal, cleanup\n'

for relation in principal principal_instance_role; do
  if [[ "${relation}" == principal ]]; then
    key_column=id
  else
    key_column=principal_id
  fi
  for database_name in clone_source clone_target; do
    psql -X -At -d "${database_name}" -c "SELECT row_to_json(row_value) FROM ${relation} row_value WHERE ${key_column} NOT IN (SELECT principal_id FROM user_account WHERE email = 'admin@local') ORDER BY ${key_column}" \
      > "${test_directory}/${database_name}-${relation}.json"
  done
  diff -u "${test_directory}/clone_source-${relation}.json" "${test_directory}/clone_target-${relation}.json"
done
NODE_ENV=production CLONE_TEST_DATABASE_URL="${target_url}" \
  "${repository_root}/apps/api/node_modules/.bin/tsx" "${repository_root}/apps/api/test/helpers/assert-clone-administrator.ts"

# A publication account can create its own staging database but lacks CREATE
# on the existing target. Failure after DROP SCHEMA must roll the drop back.
psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE ROLE clone_publisher LOGIN CREATEDB;
ALTER SCHEMA public OWNER TO clone_publisher;
SQL
write_environment "${source_url}" "postgresql://clone_publisher@${socket_host}/clone_target"
if TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute > "${test_directory}/rollback.log" 2>&1; then
  printf 'FAIL: publication without target CREATE privilege succeeded\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT count(*) FROM user_account')" == 4 ]]
[[ "$(psql -X -At -d clone_target -c 'SELECT summary FROM recipe_revision')" == 'Contact real@example.com, unchanged content' ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
printf 'PASS: publication failure rolls back schema removal and cleans staging\n'

write_environment "${source_url}" "${target_url}"
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'CREATE SCHEMA protected; CREATE VIEW protected.dependent AS SELECT id FROM public.user_account;' > /dev/null
# Dedicated-target validation rejects extra schemas even before publication.
if run_clone --env-file "${environment_file}" --execute > "${test_directory}/extra-schema.log" 2>&1; then
  printf 'FAIL: target with another schema was accepted\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT count(*) FROM protected.dependent')" == 4 ]]
printf 'PASS: unrelated target schemas are protected\n'

psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP SCHEMA protected CASCADE' > /dev/null
TMPDIR="${test_directory}" python3 "${repository_root}/scripts/test-clone-database-prompt.py" "${clone_script}" "${environment_file}"
NODE_ENV=production CLONE_TEST_DATABASE_URL="${target_url}" \
  "${repository_root}/apps/api/node_modules/.bin/tsx" "${repository_root}/apps/api/test/helpers/assert-clone-administrator.ts"
