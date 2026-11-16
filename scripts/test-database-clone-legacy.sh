#!/usr/bin/env bash

# Invoked by test-database-clone.sh inside its disposable, socket-only cluster.
set -euo pipefail
repository_root="$1"
test_directory="$2"
socket_host="$3"
createdb clone_legacy_source
createdb clone_legacy_target
baseline_file="${repository_root}/packages/db/src/migrations/sql/20261030204936_initial_schema.sql"
baseline_checksum=$(sha256sum "${baseline_file}")
baseline_checksum="${baseline_checksum%% *}"
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source -f "${baseline_file}" > "${test_directory}/legacy-schema.log"
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source --set=baseline_checksum="${baseline_checksum}" > "${test_directory}/legacy-seed.log" <<'SQL'
CREATE TABLE application_schema_migration (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO application_schema_migration VALUES
  ('20261030204936_initial_schema', :'baseline_checksum', '2026-10-30T21:00:00Z');
WITH identity AS (INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id)
INSERT INTO user_account (principal_id, email, display_name, password_hash)
SELECT id, 'old@production.example', 'Old account', 'old-production-password' FROM identity;
CREATE TABLE legacy_business (id integer PRIMARY KEY, value text);
INSERT INTO legacy_business VALUES (1, 'unchanged upgrade fixture');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clone_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO clone_reader;
SQL
legacy_source_url="postgresql://clone_reader@${socket_host}/clone_legacy_source"
legacy_target_url="postgresql://clone_test@${socket_host}/clone_legacy_target"
legacy_environment="${test_directory}/.env.legacy-clone"
printf "SOURCE_DATABASE_URL='%s'\nTARGET_DATABASE_URL='%s'\n" "${legacy_source_url}" "${legacy_target_url}" > "${legacy_environment}"
run_legacy_clone() {
  printf '%s\n' abc | TMPDIR="${test_directory}" bash "${repository_root}/scripts/clone-database.sh" \
    --env-file "${legacy_environment}" --execute --admin-password-stdin
}
assert_same_legacy_schema() {
  for database_name in clone_legacy_source clone_legacy_target; do
    pg_dump -d "${database_name}" --schema-only --schema=public --no-owner --no-acl \
      | sed '/^\\restrict /d; /^\\unrestrict /d' > "${test_directory}/${database_name}-schema.sql"
    psql -X -At -d "${database_name}" -c 'SELECT row_to_json(entry) FROM application_schema_migration entry ORDER BY id' \
      > "${test_directory}/${database_name}-ledger.json"
  done
  diff -u "${test_directory}/clone_legacy_source-schema.sql" "${test_directory}/clone_legacy_target-schema.sql"
  diff -u "${test_directory}/clone_legacy_source-ledger.json" "${test_directory}/clone_legacy_target-ledger.json"
}
run_legacy_clone
assert_same_legacy_schema
[[ "$(psql -X -At -d clone_legacy_target -c "SELECT to_regclass('public.administrative_email_recovery') IS NULL")" == t ]]
[[ "$(psql -X -At -d clone_legacy_target -c "SELECT count(*) FROM user_account WHERE email = 'admin@local'")" == 1 ]]
printf 'PASS: baseline without current administrative tables clones with identical schema and migration history\n'
NODE_ENV=production CLONE_TEST_DATABASE_URL="${legacy_target_url}" \
  "${repository_root}/apps/api/node_modules/.bin/tsx" "${repository_root}/apps/api/test/helpers/assert-clone-upgrade.ts"

# Earlier schema shapes: optional fields and entire feature tables are absent.
# Unknown retained columns, including required values, must remain intact.
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source > /dev/null <<'SQL'
ALTER TABLE user_account DROP COLUMN first_name, DROP COLUMN last_name,
  DROP COLUMN password_changed_at, DROP COLUMN password_change_required,
  DROP COLUMN deleted_at;
ALTER TABLE user_account ADD COLUMN legacy_required text NOT NULL DEFAULT 'preserve old field';
ALTER TABLE user_account ALTER COLUMN legacy_required DROP DEFAULT;
DROP TABLE instance_report_settings;
DROP TABLE instance_authentication_settings;
DROP TABLE user_session;
SQL
run_legacy_clone > "${test_directory}/legacy-missing-columns.log" 2>&1
assert_same_legacy_schema
[[ "$(psql -X -At -d clone_legacy_target -c 'SELECT legacy_required FROM user_account')" == 'preserve old field' ]]
grep -q 'Local admin@local setup skipped' "${test_directory}/legacy-missing-columns.log"
printf 'PASS: missing optional columns and feature tables do not require current schema or invented required values\n'

# A copied constraint can reject password setup. This must happen in staging,
# never after publication to the target.
psql -X -At -d clone_legacy_target -c 'SELECT password_hash FROM user_account ORDER BY email' > "${test_directory}/legacy-password-before.txt"
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source > /dev/null <<'SQL'
ALTER TABLE user_account ADD CONSTRAINT clone_hash_failure CHECK (password_hash NOT LIKE 'scrypt$%');
SQL
if run_legacy_clone > "${test_directory}/legacy-password-failure.log" 2>&1; then
  printf 'FAIL: incompatible password constraint was accepted\n' >&2
  exit 1
fi
grep -q 'Test password setup failed in the working copy. The target is unchanged.' "${test_directory}/legacy-password-failure.log"
psql -X -At -d clone_legacy_target -c 'SELECT password_hash FROM user_account ORDER BY email' > "${test_directory}/legacy-password-after.txt"
diff -u "${test_directory}/legacy-password-before.txt" "${test_directory}/legacy-password-after.txt"
[[ "$(psql -X -At -d clone_legacy_target -c "SELECT count(*) FROM pg_constraint WHERE conname = 'clone_hash_failure'")" == 0 ]]
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source -c 'ALTER TABLE user_account DROP CONSTRAINT clone_hash_failure' > /dev/null
printf 'PASS: password setup failure leaves target schema and passwords unchanged\n'

# A schema without the current identity model or unaccent is copied as-is.
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source > /dev/null <<'SQL'
SET client_min_messages = warning;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE TABLE legacy_payload (id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO legacy_payload VALUES (1, 'no current application model');
CREATE TABLE application_schema_migration (id text PRIMARY KEY, checksum text, applied_at timestamptz);
INSERT INTO application_schema_migration VALUES ('unrecognized_older_version', 'historical-checksum', '2020-01-01T00:00:00Z');
GRANT USAGE ON SCHEMA public TO clone_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clone_reader;
SQL
run_legacy_clone > "${test_directory}/legacy-no-identity.log" 2>&1
assert_same_legacy_schema
[[ "$(psql -X -At -d clone_legacy_target -c 'SELECT value FROM legacy_payload')" == 'no current application model' ]]
[[ "$(psql -X -At -d clone_legacy_target -c "SELECT count(*) FROM pg_extension WHERE extname = 'unaccent'")" == 0 ]]
printf 'PASS: unknown migration history, absent identity model, and absent current extensions are preserved without migrations\n'

# Row numbering and password replacement also work without current identity IDs
# or ordering timestamps; the tool must not invent these columns.
psql -X -v ON_ERROR_STOP=1 -d clone_legacy_source > /dev/null <<'SQL'
CREATE TABLE user_account (email text UNIQUE, display_name text, password_hash text NOT NULL);
INSERT INTO user_account VALUES
  ('user2@local', 'First original name', 'production-hash'),
  ('old@example.com', 'Second original name', 'production-hash');
GRANT SELECT ON user_account TO clone_reader;
SQL
run_legacy_clone > "${test_directory}/legacy-no-ordering.log" 2>&1
assert_same_legacy_schema
[[ "$(psql -X -At -d clone_legacy_target -c "SELECT count(*) FROM user_account WHERE email = 'user' || right(display_name, 1) || '@local' AND password_hash LIKE 'scrypt\$%'")" == 2 ]]
printf 'PASS: older accounts without IDs, timestamps, or nullable password hashes clone without schema changes\n'
