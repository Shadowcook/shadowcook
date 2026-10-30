#!/usr/bin/env bash

set -euo pipefail
umask 077
shopt -s extglob
export TZ=UTC

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source "${script_directory}/database-tools.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 BACKUP_DIRECTORY [--env-file PATH] [--execute] [--create-database]" \
    '' \
    'Validate database.dump and SHA256SUMS from an operational backup.' \
    'Without --execute, the database is not modified.' \
    'With --execute, replace backed-up objects and data in the configured database.' \
    'Stop API and web services before executing a restore.' \
    '--create-database creates a missing database using POSTGRES_* credentials.' \
    'Requires Bash and sha256sum; bundled deployments use tools in the postgres container.' \
    'Other databases require pg_restore on the host (and createdb with --create-database).'
}

environment_file="${PWD}/.env"
backup_path=''
execute=false
create_database=false

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
    --create-database)
      create_database=true
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    -*) fail "Unknown argument: $1. Use --help for usage." ;;
    *)
      [[ -z "${backup_path}" ]] || fail 'Select exactly one backup directory or database.dump file.'
      backup_path="$1"
      shift
      ;;
  esac
done

[[ -n "${backup_path}" ]] || fail 'Select a backup directory or database.dump file.'
if [[ -d "${backup_path}" ]]; then
  backup_directory=$(CDPATH= cd -- "${backup_path}" && pwd)
elif [[ -f "${backup_path}" && "$(basename -- "${backup_path}")" == database.dump ]]; then
  backup_directory=$(CDPATH= cd -- "$(dirname -- "${backup_path}")" && pwd)
else
  fail 'The backup must be a directory containing database.dump, or a completed database.dump file.'
fi
backup_file="${backup_directory}/database.dump"
[[ -f "${backup_file}" && -r "${backup_file}" && -s "${backup_file}" ]] \
  || fail 'The completed database.dump is missing, unreadable, or empty. Partial dumps cannot be restored.'
[[ -f "${backup_directory}/SHA256SUMS" && -r "${backup_directory}/SHA256SUMS" ]] \
  || fail 'The backup SHA256SUMS file is missing or unreadable.'

required_host_tools=(pg_restore)
if [[ "${create_database}" == true ]]; then
  required_host_tools+=(createdb)
fi
initialize_database_tools "${required_host_tools[@]}"
[[ "${create_database}" != true || -z "${database_url}" ]] \
  || fail '--create-database requires POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD; create external databases separately.'

expected_checksum=''
checksum_filename=''
read -r expected_checksum checksum_filename < "${backup_directory}/SHA256SUMS" \
  || fail 'Cannot read the backup checksum.'
[[ "${expected_checksum}" =~ ^[[:xdigit:]]{64}$ && "${checksum_filename}" == database.dump ]] \
  || fail 'SHA256SUMS must contain the SHA-256 checksum for database.dump.'
actual_checksum=$(sha256sum -- "${backup_file}")
actual_checksum="${actual_checksum%% *}"
[[ "${actual_checksum}" == "${expected_checksum,,}" ]] \
  || fail 'Backup checksum mismatch. No database changes were made.'

mkdir -p -- "${environment_directory}/restore-logs"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
log_directory=$(mktemp -d "${environment_directory}/restore-logs/${timestamp}.XXXXXX")
printf '[%s] Checking backup %s; target configuration: %s (%s)\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${backup_file}" "${environment_file}" "${database_tool_mode}"

if ! run_database_tool pg_restore --list < "${backup_file}" \
  > "${log_directory}/contents.list" 2> "${log_directory}/validation.log"; then
  fail "Archive validation failed. No database changes were made. See ${log_directory}/validation.log."
fi

if [[ "${execute}" != true ]]; then
  printf '[%s] Backup checksum and archive validated. No database changes were made. Use --execute to restore.\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exit 0
fi

if [[ "${create_database}" == true ]]; then
  if ! run_database_tool createdb --no-password --maintenance-db=postgres -- "${database_name}" \
    > "${log_directory}/createdb.stdout.log" 2> "${log_directory}/createdb.log"; then
    fail "Database creation failed. No restore was attempted. See ${log_directory}/createdb.log."
  fi
fi

printf '[%s] Restoring backed-up objects and data in one transaction. Logs: %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${log_directory}"
if ! run_database_tool pg_restore --dbname="${database_target}" \
  --clean --if-exists --single-transaction --exit-on-error --no-password \
  --no-owner --no-acl --verbose < "${backup_file}" \
  > "${log_directory}/restore.stdout.log" 2> "${log_directory}/restore.log"; then
  fail "Restore failed; the restore transaction was not committed. See ${log_directory}/restore.log."
fi

printf '[%s] Restore complete. You can start API and web services again. Logs: %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${log_directory}"
