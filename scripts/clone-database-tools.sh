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
  # Sessions cannot be assigned reliably to one schema. Locks during publication
  # protect public; unrelated clients and schemas are allowed.
  [[ "$(clone_query "${target_url}" \
    'SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user')" == t ]] \
    || fail 'The target account lacks CREATEDB. Grant CREATEDB to the target role or use another account; cloning requires an isolated working database.'
}

read_clone_extensions() {
  local extension_names=''
  local extension_name=''
  clone_extension_options=()
  extension_names=$(clone_query "${source_url}" \
    "SELECT extension.extname FROM pg_extension extension JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace WHERE namespace.nspname = 'public' ORDER BY extension.extname")
  while IFS= read -r extension_name; do
    [[ -n "${extension_name}" ]] || continue
    # pg_dump patterns use double quotes for exact identifier matching.
    clone_extension_options+=("--extension=\"${extension_name//\"/\"\"}\"")
  done <<< "${extension_names}"
}
