#!/usr/bin/env bash

check_clone_admin_requirements() {
  command -v node >/dev/null 2>&1 || fail 'Node.js is required for test password setup.'
  clone_api_directory="${script_directory}/../apps/api"
  clone_tsx="${clone_api_directory}/node_modules/.bin/tsx"
  [[ -x "${clone_tsx}" ]] || fail 'Install workspace dependencies before cloning; the API tsx runtime is missing.'
  if [[ ! -e ./clone-secret && "${admin_password_stdin}" != true ]]; then
    [[ -t 0 ]] || fail 'Test password setup requires a terminal, ./clone-secret, or --admin-password-stdin.'
  fi
}

run_clone_password_helper() (
  trap - EXIT INT TERM HUP
  local variable=''
  for variable in ${!PG@}; do
    unset "${variable}"
  done
  export NODE_ENV=production DATABASE_URL="$1" PGTZ=UTC
  shift
  "${clone_tsx}" "${clone_api_directory}/src/clone-database-administrator.ts" "$@"
)

read_clone_test_password() {
  local confirmation=''
  local password_from_file=false
  local -a secret_lines=()
  clone_test_password=''
  if [[ -e ./clone-secret ]]; then
    [[ -f ./clone-secret && -r ./clone-secret ]] || fail './clone-secret must be a readable regular file.'
    mapfile -t secret_lines < ./clone-secret || fail 'Could not read ./clone-secret.'
    [[ "${#secret_lines[@]}" == 1 && -n "${secret_lines[0]}" ]] \
      || fail './clone-secret must contain exactly one non-empty password line.'
    clone_test_password="${secret_lines[0]}"
    unset secret_lines
    password_from_file=true
  fi
  while true; do
    if [[ "${password_from_file}" == true ]]; then
      : # The file takes precedence over stdin and interactive input.
    elif [[ "${admin_password_stdin}" == true ]]; then
      IFS= read -r clone_test_password || fail 'No test password was received on standard input.'
    else
      printf '%s' 'New test password for all users (including admin@local): ' >&2
      IFS= read -r -s clone_test_password || fail 'Test password setup cancelled.'
      printf '\n%s' 'Repeat password: ' >&2
      IFS= read -r -s confirmation || fail 'Test password setup cancelled.'
      printf '\n' >&2
      if [[ "${clone_test_password}" != "${confirmation}" ]]; then
        printf '%s\n' 'Passwords do not match. Try again.' >&2
        continue
      fi
    fi
    if printf '%s\n' "${clone_test_password}" | run_clone_password_helper "${source_url}" --validate-password; then
      return 0
    fi
    if [[ "${password_from_file}" == true || "${admin_password_stdin}" == true ]]; then
      fail 'Test password validation failed. No database changes made.'
    fi
    printf '%s\n' 'Enter a valid password to retry, or press Ctrl+C to stop.' >&2
  done
}

configure_clone_admin_password() {
  if ! printf '%s\n' "${clone_test_password}" | run_clone_password_helper "${target_url}"; then
    unset clone_test_password
    fail 'Test password setup failed. The target was already cloned.'
  fi
  unset clone_test_password
}
