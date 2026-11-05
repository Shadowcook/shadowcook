#!/usr/bin/env bash

# Keep target routing unambiguous when replacing the database component for staging.
validate_clone_url() {
  local value="$1"
  local query=''
  local authority=''
  local parameter=''
  local -a parameters=()
  [[ "${value}" =~ ^postgres(ql)?://[^/?#]+/[^/?#]+(\?[^#]*)?$ ]] \
    || fail 'Use a PostgreSQL URL with an explicit host and database; percent-encode reserved characters.'
  authority="${value#*://}"
  authority="${authority%%/*}"
  [[ "${authority}" != *,* ]] || fail 'Use one database host per connection URL; percent-encode commas in credentials.'
  if [[ "${value}" == *'?'* ]]; then
    query="${value#*\?}"
    IFS='&' read -r -a parameters <<< "${query}"
    for parameter in "${parameters[@]}"; do
      case "${parameter%%=*}" in
        sslmode | sslrootcert | sslcert | sslkey | sslpassword | sslcrl | sslcrldir | channel_binding | connect_timeout | application_name | gssencmode) ;;
        *) fail 'Connection URL query parameters may only configure TLS, GSS, channel binding, timeout, or application name.' ;;
      esac
    done
  fi
}

clone_database_url() {
  local value="$1"
  local name="$2"
  local query=''
  local base="${value%%\?*}"
  if [[ "${value}" == *'?'* ]]; then
    query="?${value#*\?}"
  fi
  printf '%s/%s%s' "${base%/*}" "${name}" "${query}"
}

clone_tool() (
  trap - EXIT INT TERM HUP
  local connection="$1"
  local program="$2"
  shift 2
  # Ignore inherited libpq settings, including service files and connection options.
  local variable=''
  for variable in ${!PG@}; do
    unset "${variable}"
  done
  export PGCONNECT_TIMEOUT=15 PGTZ=UTC
  case "${program}" in
    psql)
      psql --no-psqlrc --no-password --dbname="${connection}" --set=ON_ERROR_STOP=1 "$@"
      ;;
    pg_dump)
      pg_dump --no-password --dbname="${connection}" "$@"
      ;;
    pg_restore)
      pg_restore --no-password --dbname="${connection}" "$@"
      ;;
    createdb | dropdb)
      "${program}" --no-password --maintenance-db="${connection}" "$@"
      ;;
    *)
      fail 'Unsupported clone database tool.'
      ;;
  esac
)

clone_query() {
  clone_tool "$1" psql --tuples-only --no-align --quiet --command "$2"
}

check_clone_target() {
  local connections=''
  connections=$(clone_query "${target_url}" \
    'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()')
  [[ "${connections}" == 0 ]] || fail 'The target has other database connections. Stop its API, web, and other clients first.'
  [[ "$(clone_query "${target_url}" \
    "SELECT count(*) FROM pg_namespace WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_'")" == 0 ]] \
    || fail 'The target contains additional schemas. Select a dedicated Shadowcook test database.'
}
