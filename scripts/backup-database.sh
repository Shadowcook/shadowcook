#!/usr/bin/env bash

set -euo pipefail
umask 077
shopt -s extglob
export TZ=UTC

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source "${script_directory}/database-tools.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 [--env-file PATH] [--output-dir PATH]" \
    '' \
    'Create a PostgreSQL custom-format backup using credentials from .env.' \
    'Defaults: .env in the current directory; backups beside the selected .env.' \
    'Requires Bash and sha256sum.' \
    'Bundled deployments use Docker Compose and PostgreSQL tools inside the running postgres container.' \
    'Other databases require pg_dump and pg_restore on the host.'
}

environment_file="${PWD}/.env"
output_directory=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file | --output-dir)
      [[ $# -ge 2 && -n "$2" ]] || fail "Missing value for $1."
      if [[ "$1" == --env-file ]]; then
        environment_file="$2"
      else
        output_directory="$2"
      fi
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1. Use --help for usage."
      ;;
  esac
done

initialize_database_tools pg_dump pg_restore
output_directory="${output_directory:-${environment_directory}/backups}"

mkdir -p -- "${output_directory}"
output_directory=$(CDPATH= cd -- "${output_directory}" && pwd)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_directory="${output_directory}/${timestamp}"
mkdir -- "${backup_directory}" \
  || fail 'Cannot create the timestamp directory. An existing backup is never overwritten; retry in a second.'

backup_completed=false
report_failure() {
  if [[ "${backup_completed}" != true ]]; then
    printf '[%s] Backup incomplete. Diagnostic files and any partial dump remain in %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${backup_directory}" >&2
  fi
}
trap report_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

printf '[%s] Creating database backup in %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${backup_directory}"

if ! run_database_tool pg_dump --format=custom --no-password \
  > "${backup_directory}/database.dump.partial" 2> "${backup_directory}/pg_dump.log"; then
  fail "pg_dump failed. See ${backup_directory}/pg_dump.log."
fi

[[ -s "${backup_directory}/database.dump.partial" ]] || fail 'pg_dump produced an empty backup.'
if ! run_database_tool pg_restore --list < "${backup_directory}/database.dump.partial" \
  > "${backup_directory}/contents.list" 2> "${backup_directory}/pg_restore.log"; then
  fail "Backup archive validation failed. See ${backup_directory}/pg_restore.log."
fi

mv -- "${backup_directory}/database.dump.partial" "${backup_directory}/database.dump"
(
  cd -- "${backup_directory}"
  sha256sum database.dump > SHA256SUMS
)
backup_completed=true
printf '[%s] Backup complete: %s/database.dump\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${backup_directory}"
