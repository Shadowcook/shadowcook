#!/usr/bin/env bash

set -euo pipefail
umask 077
shopt -s extglob
export TZ=UTC

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source "${script_directory}/database-tools.sh"
source "${script_directory}/clone-database-tools.sh"
source "${script_directory}/clone-database-admin.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 [--env-file PATH] [--execute] [--admin-password-stdin]" \
    '' \
    'Clone SOURCE_DATABASE_URL to TARGET_DATABASE_URL from .env.db-clone.' \
    'Without --execute, only read-only connection and target checks run.' \
    'With --execute, replace the target public schema with a sanitized source copy.' \
    'Business data remains unchanged; profiles, credentials, and mail settings are sanitized.' \
    'After import, enter and confirm a hidden test password for all users, including the additional admin@local account.' \
    '--admin-password-stdin reads one shared test password line for all users after import.' \
    'Execution requires installed workspace dependencies for the API password helper.' \
    'Stop target API, web, and other database clients before execution.' \
    'Requires host psql, pg_dump, pg_restore, createdb, and dropdb.' \
    'The target account needs CREATEDB, CREATE on the target database, and ownership of its public schema.'
}

environment_file="${PWD}/.env.db-clone"
execute=false
admin_password_stdin=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 && -n "$2" ]] || fail 'Missing value for --env-file.'
      environment_file="$2"
      shift 2
      ;;
    --execute)
      execute=true
      shift
      ;;
    --admin-password-stdin)
      admin_password_stdin=true
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "Unknown argument: $1. Use --help for usage." ;;
  esac
done

[[ -f "${environment_file}" && -r "${environment_file}" ]] || fail 'The selected clone environment file is not readable.'
source_url=$(read_environment_value SOURCE_DATABASE_URL)
target_url=$(read_environment_value TARGET_DATABASE_URL)
validate_clone_url "${source_url}"
validate_clone_url "${target_url}"
[[ "${source_url}" != "${target_url}" ]] || fail 'Source and target must be different databases.'
for program in psql pg_dump pg_restore createdb dropdb; do
  command -v "${program}" >/dev/null 2>&1 || fail "Required host program is missing: ${program}."
done

# Database OID and server start time also detect different users, DNS names, and
# URL encodings that refer to the same running database, without source writes.
identity_sql='SELECT oid::text || chr(9) || datname || chr(9) || extract(epoch FROM pg_postmaster_start_time())::text FROM pg_database WHERE datname = current_database()'
source_identity=$(clone_query "${source_url}" "${identity_sql}")
target_identity=$(clone_query "${target_url}" "${identity_sql}")
[[ -n "${source_identity}" && -n "${target_identity}" ]] || fail 'Cannot identify both databases.'
[[ "${source_identity}" != "${target_identity}" ]] || fail 'Source and target resolve to the same database.'
check_clone_target
printf '[%s] Source and target checks passed.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "${execute}" != true ]]; then
  printf '%s\n' 'No database changes made. Use --execute to clone; the target public schema will be replaced.'
  exit 0
fi
check_clone_admin_requirements

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/shadowcook-clone.XXXXXXXXXX")
stage_name="shadowcook_clone_$(date -u +%Y%m%d%H%M%S)_${work_directory##*.}"
stage_url=$(clone_database_url "${target_url}" "${stage_name}")
stage_created=false
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${stage_created}" == true ]]; then
    if ! clone_tool "${target_url}" dropdb --if-exists -- "${stage_name}" >> "${work_directory}/tools.log" 2>&1; then
      printf '[%s] Could not remove temporary database %s. Remove it manually.\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${stage_name}" >&2
      result=1
    fi
  fi
  if [[ "${result}" != 0 ]]; then
    # Dumps can include all production content. Keep diagnostics, remove dumps.
    rm -f -- "${work_directory}/source.dump" "${work_directory}/sanitized.dump" "${work_directory}/restore.sql"
    printf '[%s] Clone failed. Private diagnostic files: %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${work_directory}" >&2
  else
    rm -rf -- "${work_directory}"
  fi
  exit "${result}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

printf '[%s] Exporting source and preparing isolated working database.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
clone_tool "${source_url}" pg_dump --format=custom > "${work_directory}/source.dump" 2> "${work_directory}/tools.log"
clone_tool "${target_url}" createdb --template=template0 -- "${stage_name}" >> "${work_directory}/tools.log" 2>&1
stage_created=true
clone_tool "${stage_url}" pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  "${work_directory}/source.dump" >> "${work_directory}/tools.log" 2>&1

printf '[%s] Sanitizing profiles, credentials, and delivery settings; validating business data.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
clone_tool "${stage_url}" psql --single-transaction --file="${script_directory}/clone-database-sanitize.sql" \
  >> "${work_directory}/tools.log" 2>&1
clone_tool "${stage_url}" pg_dump --format=custom > "${work_directory}/sanitized.dump" 2>> "${work_directory}/tools.log"

# Render first: archive errors must occur before the target transaction starts.
pg_restore --clean --if-exists --no-owner --no-acl --file="${work_directory}/restore.sql" \
  "${work_directory}/sanitized.dump" 2>> "${work_directory}/tools.log"
check_clone_target
[[ "$(clone_query "${target_url}" "${identity_sql}")" == "${target_identity}" ]] \
  || fail 'The target identity changed while preparing the copy.'
printf '[%s] Replacing the target public schema in one transaction.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Removing the old schema also removes stale objects from previously tested
# versions. A restore error rolls back this removal. Standard dumps omit the
# default public schema; --clean also handles archives that explicitly include it.
clone_tool "${target_url}" psql --single-transaction \
  --command="SET lock_timeout = '10s'; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  --file="${work_directory}/restore.sql" >> "${work_directory}/tools.log" 2>&1
configure_clone_admin_password
printf '[%s] Clone complete. Test passwords are set for all users; admin@local is ready. Copy media separately before starting the target.\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
