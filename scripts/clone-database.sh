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
    'Before copying, enter and confirm a hidden test password for all users, including the additional admin@local account.' \
    './clone-secret supplies the password when present; otherwise --admin-password-stdin reads one line.' \
    'Execution requires installed workspace dependencies for the API password helper.' \
    'Stop target Shadowcook clients before execution; unrelated schemas and clients may remain.' \
    'Requires host psql, pg_dump, pg_restore, createdb, and dropdb.' \
    'The target account needs CREATEDB, target CREATE, public ownership, and permission to install copied extensions.'
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
read_clone_extensions
check_clone_target
printf '[%s] Source and target checks passed.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "${execute}" != true ]]; then
  printf '%s\n' 'No database changes made. Use --execute to clone; the target public schema will be replaced.'
  exit 0
fi
check_clone_admin_requirements
read_clone_test_password

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/shadowcook-clone.XXXXXXXXXX")
stage_name="shadowcook_clone_$(date -u +%Y%m%d%H%M%S)_${work_directory##*.}"
stage_url=$(clone_database_url "${target_url}" "${stage_name}")
stage_created=false
# EXIT traps can run while a failed shell function's stderr is still redirected.
# Keep the operator's original stderr independent of dump and tool-log redirects.
exec {clone_diagnostics_fd}>&2
clone_phase='preparing the working database'
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${stage_created}" == true ]]; then
    if ! clone_tool "${target_url}" dropdb --if-exists -- "${stage_name}" >> "${work_directory}/tools.log" 2>&1; then
      printf '[%s] Could not remove temporary database %s. Remove it manually.\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${stage_name}" >&"${clone_diagnostics_fd}"
      result=1
    fi
  fi
  if [[ "${result}" != 0 ]]; then
    # Dumps can include all production content. Keep diagnostics, remove dumps.
    rm -f -- "${work_directory}/source.dump" "${work_directory}/sanitized.dump" "${work_directory}/restore.sql"
    printf '[%s] Clone failed during %s (exit code %s). Details: %s/tools.log\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${clone_phase}" "${result}" "${work_directory}" >&"${clone_diagnostics_fd}"
  else
    rm -rf -- "${work_directory}"
  fi
  exit "${result}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

printf '[%s] Exporting source and preparing isolated working database.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
clone_phase='exporting the source schema'
clone_tool "${source_url}" pg_dump --format=custom --schema=public "${clone_extension_options[@]}" --strict-names \
  > "${work_directory}/source.dump" 2> "${work_directory}/tools.log"
clone_phase='creating the working database'
clone_tool "${target_url}" createdb --template=template0 -- "${stage_name}" >> "${work_directory}/tools.log" 2>&1
stage_created=true
clone_phase='restoring the working database'
clone_tool "${stage_url}" pg_restore --single-transaction --exit-on-error --clean --if-exists --no-owner --no-acl \
  "${work_directory}/source.dump" >> "${work_directory}/tools.log" 2>&1

printf '[%s] Sanitizing profiles, credentials, and delivery settings; validating business data.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
clone_phase='sanitizing and validating the working copy'
clone_tool "${stage_url}" psql --single-transaction --file="${script_directory}/clone-database-sanitize.sql" \
  >> "${work_directory}/tools.log" 2>&1
clone_phase='setting test passwords in the working copy'
configure_clone_admin_password "${stage_url}"
clone_phase='exporting the sanitized copy'
clone_tool "${stage_url}" pg_dump --format=custom --schema=public "${clone_extension_options[@]}" --strict-names \
  > "${work_directory}/sanitized.dump" 2>> "${work_directory}/tools.log"

# Render first: archive errors must occur before the target transaction starts.
clone_phase='preparing the target import'
pg_restore --clean --if-exists --no-owner --no-acl --file="${work_directory}/restore.sql" \
  "${work_directory}/sanitized.dump" 2>> "${work_directory}/tools.log"
clone_phase='rechecking the target'
check_clone_target
[[ "$(clone_query "${target_url}" "${identity_sql}")" == "${target_identity}" ]] \
  || fail 'The target identity changed while preparing the copy.'
printf '[%s] Replacing the target public schema in one transaction.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
clone_phase='replacing the target public schema'
# Guard the actual cascade in this transaction, including dependencies created
# after preflight. Any damage outside public rolls back the entire publication.
clone_tool "${target_url}" psql --single-transaction \
  --file="${script_directory}/clone-database-replace-schema.sql" \
  --file="${work_directory}/restore.sql" \
  --file="${script_directory}/clone-database-verify-schemas.sql" >> "${work_directory}/tools.log" 2>&1
printf '[%s] Clone complete. Copy media separately before starting the target.\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
