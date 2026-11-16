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
cd "${test_directory}"
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
psql -X -v ON_ERROR_STOP=1 -d clone_source \
  -f "${repository_root}/packages/db/src/migrations/sql/20261109230236_cookbook_name_reset.sql" \
  >> "${test_directory}/schema.log"
psql -X -v ON_ERROR_STOP=1 -d clone_source \
  -f "${repository_root}/packages/db/src/migrations/sql/20261111222940_administrative_audit.sql" \
  >> "${test_directory}/schema.log"
psql -X -v ON_ERROR_STOP=1 -d clone_source > "${test_directory}/seed.log" <<'SQL'
CREATE ROLE clone_reader LOGIN;
GRANT CONNECT ON DATABASE clone_source TO clone_reader;
GRANT USAGE ON SCHEMA public TO clone_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clone_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO clone_reader;
ALTER ROLE clone_reader SET default_transaction_read_only = on;
ALTER ROLE clone_reader SET search_path = source_private, pg_catalog;
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
INSERT INTO administrative_email_recovery (user_account_id, actor_principal_id, new_email, token_hash, expires_at, reason)
  VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'recovery@production.example', decode(repeat('cd', 32), 'hex'), now() + interval '1 hour', 'Clone test recovery');
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
ALTER TABLE user_account ADD COLUMN legacy_profile_data text DEFAULT 'retain legacy field';
-- These contents must not be exported, even with no source-reader access.
CREATE SCHEMA source_private;
CREATE TABLE source_private.secret (value text);
INSERT INTO source_private.secret VALUES ('never copy another application');
CREATE EXTENSION hstore WITH SCHEMA source_private;
-- Cloning must ignore both the source and copied entropy thresholds.
INSERT INTO instance_authentication_settings (singleton, minimum_password_entropy)
VALUES (true, 256)
ON CONFLICT (singleton) DO UPDATE SET minimum_password_entropy = 256;
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
  printf '%s\n' 'abc' \
    | bash "${clone_script}" --admin-password-stdin "$@"
}
write_environment "${source_url}" "${target_url}"
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'CREATE TABLE target_sentinel (value text); INSERT INTO target_sentinel VALUES ('\''keep until success'\'');' > /dev/null
psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE SCHEMA shared;
CREATE TABLE shared.sentinel (id integer PRIMARY KEY, value text);
INSERT INTO shared.sentinel VALUES (1, 'keep another application');
CREATE VIEW shared.independent AS SELECT * FROM shared.sentinel;
CREATE EXTENSION hstore WITH SCHEMA shared;
SQL
run_clone --env-file "${environment_file}"
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
printf 'PASS: validation does not modify the target\n'

# Reject missing staging privileges before passwords, exports, or writes.
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'CREATE ROLE clone_restricted LOGIN' > /dev/null
write_environment "${source_url}" "postgresql://clone_restricted@${socket_host}/clone_target"
for execution_mode in '' '--execute'; do
  if run_clone --env-file "${environment_file}" ${execution_mode} > "${test_directory}/missing-createdb.log" 2>&1; then
    printf 'FAIL: target role without CREATEDB was accepted\n' >&2
    exit 1
  fi
  grep -q 'The target account lacks CREATEDB' "${test_directory}/missing-createdb.log"
  if grep -Eq 'checks passed|New test password|Exporting source' "${test_directory}/missing-createdb.log"; then
    printf 'FAIL: missing CREATEDB was detected after preflight\n' >&2
    exit 1
  fi
done
write_environment "${source_url}" "${target_url}"
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
printf 'PASS: missing CREATEDB is reported before password entry or source export\n'

# A command failure with stderr redirected must still report the phase and log
# path on the operator's stderr, preserving its exit code and cleaning dumps.
mkdir "${test_directory}/failing-tools"
cat > "${test_directory}/failing-tools/createdb" <<'SH'
#!/usr/bin/env bash
printf '%s\n' 'Controlled working-database creation failure.' >&2
exit 42
SH
chmod 700 "${test_directory}/failing-tools/createdb"
if PATH="${test_directory}/failing-tools:${PATH}" TMPDIR="${test_directory}" \
  run_clone --env-file "${environment_file}" --execute > "${test_directory}/tool-failure.stdout" 2> "${test_directory}/tool-failure.stderr"; then
  printf 'FAIL: controlled createdb failure was accepted\n' >&2
  exit 1
else
  [[ "$?" == 42 ]]
fi
grep -q 'Clone failed during creating the working database (exit code 42)' "${test_directory}/tool-failure.stderr"
diagnostic_log=$(sed -n 's/^.*Details: \(.*\/tools.log\)$/\1/p' "${test_directory}/tool-failure.stderr")
[[ -f "${diagnostic_log}" ]]
grep -q 'Controlled working-database creation failure' "${diagnostic_log}"
[[ ! -e "${diagnostic_log%/*}/source.dump" ]]
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
printf 'PASS: redirected command failures report phase, exit code, and readable diagnostics\n'

# Keep a transaction accessing another schema open through a complete clone.
# This must not block replacement of public or be rejected by preflight.
start_test_client() {
  local relation="${1:-shared.sentinel}"
  rm -f "${test_directory}/client-ready"
  PGAPPNAME=clone_integration_client psql -X -q -d clone_target > "${test_directory}/active-client.log" 2>&1 <<SQL &
BEGIN;
SELECT * FROM ${relation};
\o ${test_directory}/client-ready
SELECT 1;
\o
SELECT pg_sleep(300);
SQL
  client_pid=$!
  for ((attempt = 0; attempt < 100; attempt++)); do
    [[ ! -s "${test_directory}/client-ready" ]] || break
    sleep 0.05
  done
  [[ -s "${test_directory}/client-ready" ]]
}
stop_test_client() {
  # Terminate only the session started by this test, within its private cluster.
  psql -X -q -d clone_source -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'clone_target' AND application_name = 'clone_integration_client'" > /dev/null
  wait "${client_pid}" 2>/dev/null || true
  client_pid=''
}
start_test_client
run_clone --env-file "${environment_file}"
stop_test_client
printf 'PASS: preflight allows unrelated schemas and active clients\n'

write_environment "${source_url}" "postgresql://clone_test@${socket_host}/clone_source?application_name=alias"
if run_clone --env-file "${environment_file}" --execute > "${test_directory}/same-database.log" 2>&1; then
  printf 'FAIL: same-database alias was accepted\n' >&2
  exit 1
fi
write_environment "${source_url}" "${target_url}"

# Data-changing triggers must still fail preservation checks in staging.
psql -X -v ON_ERROR_STOP=1 -d clone_source > /dev/null <<'SQL'
CREATE FUNCTION alter_clone_business_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_login_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER alter_clone_business_data BEFORE UPDATE ON user_account
FOR EACH ROW EXECUTE FUNCTION alter_clone_business_data();
SQL
if TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute > "${test_directory}/unsupported-schema.log" 2>&1; then
  printf 'FAIL: business-data changes during sanitization were accepted\n' >&2
  exit 1
fi
grep -q 'Clone failed during sanitizing and validating the working copy' "${test_directory}/unsupported-schema.log"
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_source -c 'DROP TRIGGER alter_clone_business_data ON user_account; DROP FUNCTION alter_clone_business_data()' > /dev/null
printf 'PASS: aliases rejected; sanitization failure preserves target and cleans staging\n'

# File and stdin password failures must happen before staging or target changes.
printf -v oversized_secret '%1025s' ''
for invalid_secret in '' "${oversized_secret}" $'first\nsecond'; do
  printf '%s\n' "${invalid_secret}" > clone-secret
  if run_clone --env-file "${environment_file}" --execute > "${test_directory}/invalid-secret.log" 2>&1; then
    printf 'FAIL: invalid clone-secret was accepted\n' >&2
    exit 1
  fi
  [[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
  [[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
done
rm clone-secret
if printf '%s\n' '' | bash "${clone_script}" --admin-password-stdin --env-file "${environment_file}" --execute > "${test_directory}/invalid-stdin.log" 2>&1; then
  printf 'FAIL: invalid stdin password was accepted\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
printf 'PASS: invalid passwords rejected before cloning\n'

# A public object depending on an excluded source schema must fail in staging.
psql -X -v ON_ERROR_STOP=1 -d clone_source > /dev/null <<'SQL'
CREATE VIEW public.external_source_dependency AS SELECT value FROM source_private.secret;
GRANT SELECT ON public.external_source_dependency TO clone_reader;
SQL
if TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute > "${test_directory}/source-dependency.log" 2>&1; then
  printf 'FAIL: source dependency outside public was accepted\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM target_sentinel')" == 'keep until success' ]]
[[ "$(psql -X -At -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'shadowcook_clone_%'")" == 0 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_source -c 'DROP VIEW public.external_source_dependency' > /dev/null
printf 'PASS: unsupported source dependencies fail before publication\n'

# A file without a final newline works without a terminal and overrides stdin.
printf '%s' 'abc' > clone-secret
start_test_client
TMPDIR="${test_directory}" bash "${clone_script}" --env-file "${environment_file}" --execute < /dev/null
stop_test_client
printf '%s\n' 'abc' > clone-secret
printf '%s\n' '' | TMPDIR="${test_directory}" bash "${clone_script}" --admin-password-stdin --env-file "${environment_file}" --execute
rm clone-secret
printf 'PASS: clone-secret supports optional final newline, noninteractive use, and precedence over stdin\n'
psql -X -v ON_ERROR_STOP=1 -d clone_target > "${test_directory}/assertions.log" <<'SQL'
DO $$
BEGIN
  IF to_regnamespace('source_private') IS NOT NULL
    OR (SELECT value FROM shared.independent) <> 'keep another application'
    OR (SELECT extnamespace FROM pg_extension WHERE extname = 'hstore') <> 'shared'::regnamespace
  THEN RAISE EXCEPTION 'Unrelated schema or extension was copied or changed'; END IF;
  IF (SELECT count(*) FROM user_account) <> 4 OR EXISTS (
    SELECT 1 FROM user_account WHERE email <> 'admin@local' AND (display_name <> 'User ' || right(id::text, 1)
      OR email <> 'user' || right(id::text, 1) || '@local'
      OR password_hash IS NULL OR password_changed_at IS NULL OR password_change_required
      OR first_name IS NOT NULL OR last_name IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Profile sanitization failed'; END IF;
  IF EXISTS (SELECT 1 FROM user_account WHERE legacy_profile_data IS DISTINCT FROM 'retain legacy field')
  THEN RAISE EXCEPTION 'Unknown profile column was changed'; END IF;
  IF EXISTS (SELECT 1 FROM user_session) OR EXISTS (SELECT 1 FROM password_reset_token)
    OR EXISTS (SELECT 1 FROM pending_registration) OR EXISTS (SELECT 1 FROM recipe_share_link)
    OR EXISTS (SELECT 1 FROM instance_mail_settings)
    OR EXISTS (SELECT 1 FROM administrative_email_recovery)
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
      'account_email_change', 'administrative_email_recovery', 'email_one_time_code', 'password_login_failure', 'registration_rate_event',
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
# The actual cascade must fail inside the publication transaction.
if TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute > "${test_directory}/extra-schema.log" 2>&1; then
  printf 'FAIL: destructive cross-schema dependency was accepted\n' >&2
  exit 1
fi
[[ "$(psql -X -At -d clone_target -c 'SELECT count(*) FROM protected.dependent')" == 4 ]]
grep -q 'Replacing public would damage an object in another schema' "${test_directory}"/shadowcook-clone.*/tools.log
printf 'PASS: cross-schema view dependency rolls back publication\n'

psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP SCHEMA protected CASCADE' > /dev/null

# Exercise objects without their own namespace as well as transitive ownership
# edges. Explicit rollback keeps the fixture intact even if a guard regresses.
assert_dependency_rollback() {
  if psql -X -v ON_ERROR_STOP=1 -d clone_target --single-transaction \
    --file="${repository_root}/scripts/clone-database-replace-schema.sql" \
    --file="${repository_root}/scripts/clone-database-verify-schemas.sql" \
    --command=ROLLBACK > "${test_directory}/dependency-guard.log" 2>&1; then
    printf 'FAIL: destructive cross-schema cascade was accepted\n' >&2
    exit 1
  fi
  grep -q 'Replacing public would damage an object in another schema' "${test_directory}/dependency-guard.log"
  [[ "$(psql -X -At -d clone_target -c 'SELECT count(*) FROM public.user_account')" == 4 ]]
}
psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE TABLE shared.referencing_user (user_id uuid REFERENCES public.user_account(id));
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c "SELECT count(*) FROM pg_constraint WHERE conrelid = 'shared.referencing_user'::regclass AND contype = 'f'")" == 1 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP TABLE shared.referencing_user' > /dev/null

psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE SEQUENCE public.external_default_sequence;
CREATE TABLE shared.default_dependency (id bigint DEFAULT nextval('public.external_default_sequence'));
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c "SELECT count(*) FROM pg_attrdef WHERE adrelid = 'shared.default_dependency'::regclass")" == 1 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP TABLE shared.default_dependency; DROP SEQUENCE public.external_default_sequence' > /dev/null

psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE TYPE public.external_column_type AS ENUM ('keep');
CREATE TABLE shared.column_dependency (value public.external_column_type);
INSERT INTO shared.column_dependency VALUES ('keep');
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM shared.column_dependency')" == keep ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP TABLE shared.column_dependency; DROP TYPE public.external_column_type' > /dev/null

psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE VIEW public.internal_view AS SELECT id FROM public.user_account;
CREATE VIEW shared.transitive_dependency AS SELECT id FROM public.internal_view;
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c 'SELECT count(*) FROM shared.transitive_dependency')" == 4 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP VIEW shared.transitive_dependency; DROP VIEW public.internal_view' > /dev/null

psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE FUNCTION public.external_trigger_function() RETURNS trigger LANGUAGE plpgsql
AS $$ BEGIN RETURN NEW; END; $$;
CREATE TRIGGER external_trigger BEFORE INSERT ON shared.sentinel
FOR EACH ROW EXECUTE FUNCTION public.external_trigger_function();
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'shared.sentinel'::regclass AND tgname = 'external_trigger'")" == 1 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP TRIGGER external_trigger ON shared.sentinel; DROP FUNCTION public.external_trigger_function()' > /dev/null

# unaccent is replaced with public; its external consumers must also survive.
psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
CREATE VIEW shared.extension_dependency AS SELECT public.unaccent('keep') AS value;
SQL
assert_dependency_rollback
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM shared.extension_dependency')" == keep ]]
psql -X -v ON_ERROR_STOP=1 -d clone_target -c 'DROP VIEW shared.extension_dependency' > /dev/null
printf 'PASS: cross-schema foreign keys, defaults, columns, views, triggers, and extension dependencies roll back\n'

# A lock on public must cause a bounded failure, without terminating the client.
start_test_client public.user_account
if psql -X -v ON_ERROR_STOP=1 -d clone_target --single-transaction \
  --file="${repository_root}/scripts/clone-database-replace-schema.sql" \
  --command=ROLLBACK > "${test_directory}/public-lock.log" 2>&1; then
  printf 'FAIL: publication ignored an active public lock\n' >&2
  exit 1
fi
grep -q 'lock timeout' "${test_directory}/public-lock.log"
kill -0 "${client_pid}"
stop_test_client

printf 'PASS: active public locks abort publication without terminating clients\n'

# The protection must also work without superuser privileges.
psql -X -v ON_ERROR_STOP=1 -d clone_target > /dev/null <<'SQL'
GRANT CREATE ON DATABASE clone_target TO clone_publisher;
ALTER SCHEMA public OWNER TO clone_publisher;
ALTER ROLE clone_publisher SET search_path = shared, pg_catalog;
SQL
write_environment "${source_url}" "postgresql://clone_publisher@${socket_host}/clone_target"
TMPDIR="${test_directory}" run_clone --env-file "${environment_file}" --execute
[[ "$(psql -X -At -d clone_target -c 'SELECT value FROM shared.independent')" == 'keep another application' ]]
printf 'PASS: non-superuser publication preserves unrelated schemas\n'
write_environment "${source_url}" "${target_url}"
TMPDIR="${test_directory}" python3 "${repository_root}/scripts/test-clone-database-prompt.py" "${clone_script}" "${environment_file}"
NODE_ENV=production CLONE_TEST_DATABASE_URL="${target_url}" \
  "${repository_root}/apps/api/node_modules/.bin/tsx" "${repository_root}/apps/api/test/helpers/assert-clone-administrator.ts"

bash "${repository_root}/scripts/test-database-clone-legacy.sh" "${repository_root}" "${test_directory}" "${socket_host}"
