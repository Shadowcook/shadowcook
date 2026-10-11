#!/usr/bin/env bash

fail() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2
  exit 1
}

# Parse single-line literal dotenv values without executing shell expressions.
read_environment_value() {
  local requested_key="$1"
  local line=''
  local value=''
  local result=''
  local quote=''
  local remainder=''

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?${requested_key}[[:space:]]*=(.*)$ ]]; then
      value="${BASH_REMATCH[2]}"
      value="${value##+([[:space:]])}"
      case "${value:0:1}" in
        "'" | '"')
          quote="${value:0:1}"
          value="${value:1}"
          [[ "${value}" == *"${quote}"* ]] \
            || fail "${requested_key} must be a single-line value with matching quotes."
          remainder="${value#*"${quote}"}"
          remainder="${remainder##+([[:space:]])}"
          [[ -z "${remainder}" || "${remainder}" == \#* ]] \
            || fail "Unexpected content after the quoted ${requested_key} value."
          result="${value%%"${quote}"*}"
          ;;
        *)
          value="${value%%#*}"
          result="${value%%+([[:space:]])}"
          ;;
      esac
    fi
  done < "${environment_file}"

  printf '%s' "${result}"
}

initialize_database_tools() {
  [[ -f "${environment_file}" && -r "${environment_file}" ]] \
    || fail 'The selected .env file does not exist or is not readable.'
  environment_directory=$(CDPATH= cd -- "$(dirname -- "${environment_file}")" && pwd)
  environment_file="${environment_directory}/$(basename -- "${environment_file}")"

  database_url=$(read_environment_value DATABASE_URL)
  database_target="${database_url}"
  database_tool_mode=host
  compose_command=()
  if [[ -n "${database_url}" ]]; then
    case "${database_url}" in
      postgres://* | postgresql://*) ;;
      *) fail 'DATABASE_URL must use the postgres:// or postgresql:// protocol.' ;;
    esac
  else
    database_name=$(read_environment_value POSTGRES_DB)
    database_user=$(read_environment_value POSTGRES_USER)
    database_password=$(read_environment_value POSTGRES_PASSWORD)
    database_host=$(read_environment_value SHADOWCOOK_POSTGRES_BIND)
    database_port=$(read_environment_value SHADOWCOOK_POSTGRES_PORT)
    [[ -n "${database_name}" && -n "${database_user}" && -n "${database_password}" ]] \
      || fail 'Configure DATABASE_URL or POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD in .env.'
    database_target="${database_name}"
    database_host="${database_host:-127.0.0.1}"
    database_port="${database_port:-5432}"
    case "${database_host}" in
      0.0.0.0 | :: | '[::]') database_host=127.0.0.1 ;;
    esac

    compose_file=$(read_environment_value COMPOSE_FILE)
    if [[ -n "${compose_file}" || -f "${environment_directory}/compose.yaml" ]]; then
      compose_file="${compose_file:-compose.yaml}"
      if [[ "${compose_file}" != /* ]]; then
        compose_file="${environment_directory}/${compose_file}"
      fi
      [[ -f "${compose_file}" ]] || fail 'The selected Docker Compose file does not exist.'
      database_tool_mode=docker
      compose_command=(docker compose --project-directory "${environment_directory}"
        --env-file "${environment_file}" --file "${compose_file}" exec -T)
    fi
  fi

  local required_commands=(sha256sum)
  local required_command
  if [[ "${database_tool_mode}" == docker ]]; then
    required_commands+=(docker)
  else
    required_commands+=("$@")
  fi
  for required_command in "${required_commands[@]}"; do
    command -v "${required_command}" >/dev/null 2>&1 \
      || fail "Required command is missing: ${required_command}. Use --help for prerequisites."
  done
}

# Run tools using connection settings from the selected file.
run_database_tool() (
  unset PGDATABASE PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE
  export PGCONNECT_TIMEOUT=15
  if [[ -n "${database_url}" ]]; then
    unset PGDATABASE
  else
    export PGDATABASE="${database_name}" PGUSER="${database_user}" PGPASSWORD="${database_password}"
    export PGHOST="${database_host}" PGPORT="${database_port}"
  fi

  if [[ "${database_tool_mode}" == docker ]]; then
    unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR COMPOSE_PROJECT_NAME
    export POSTGRES_DB="${database_name}" POSTGRES_USER="${database_user}" POSTGRES_PASSWORD="${database_password}"
    export PGHOST=127.0.0.1 PGPORT=5432
    "${compose_command[@]}" \
      --env PGDATABASE --env PGUSER --env PGPASSWORD --env PGHOST --env PGPORT \
      --env PGCONNECT_TIMEOUT --env TZ \
      postgres sh -c '
        unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE
        exec "$@"
      ' shadowcook-database "$@"
  elif [[ -n "${database_url}" && "$1" == pg_dump ]]; then
    # libpq does not expand connection URLs supplied through PGDATABASE.
    shift
    pg_dump --dbname="${database_url}" "$@"
  else
    "$@"
  fi
)
