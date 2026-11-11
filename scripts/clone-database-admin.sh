#!/usr/bin/env bash

check_clone_admin_requirements() {
  command -v node >/dev/null 2>&1 || fail 'Node.js is required for test password setup.'
  clone_api_directory="${script_directory}/../apps/api"
  clone_tsx="${clone_api_directory}/node_modules/.bin/tsx"
  [[ -x "${clone_tsx}" ]] || fail 'Install workspace dependencies before cloning; the API tsx runtime is missing.'
  if [[ "${admin_password_stdin}" != true ]]; then
    [[ -t 0 ]] || fail 'Test password setup requires a terminal. For automation, use --admin-password-stdin.'
  fi
}

write_clone_admin_password() (
  trap - EXIT INT TERM HUP
  local variable=''
  for variable in ${!PG@}; do
    unset "${variable}"
  done
  export NODE_ENV=production DATABASE_URL="${target_url}" PGTZ=UTC
  "${clone_tsx}" "${clone_api_directory}/src/clone-database-administrator.ts"
)

configure_clone_admin_password() {
  local password=''
  local confirmation=''
  printf '[%s] Target import complete. Set the shared test password for all users, including admin@local.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  while true; do
    if [[ "${admin_password_stdin}" == true ]]; then
      IFS= read -r password || fail 'No test password was received on standard input. The target was already cloned.'
    else
      printf '%s' 'New test password for all users (including admin@local): ' >&2
      IFS= read -r -s password || fail 'Test password setup cancelled. The target was already cloned.'
      printf '\n%s' 'Repeat password: ' >&2
      IFS= read -r -s confirmation || fail 'Test password setup cancelled. The target was already cloned.'
      printf '\n' >&2
      if [[ "${password}" != "${confirmation}" ]]; then
        printf '%s\n' 'Passwords do not match. Try again.' >&2
        continue
      fi
    fi
    if printf '%s\n' "${password}" | write_clone_admin_password; then
      unset password confirmation
      return 0
    fi
    if [[ "${admin_password_stdin}" == true ]]; then
      fail 'Test password setup failed. The target was already cloned.'
    fi
    printf '%s\n' 'Test password setup failed. Enter a valid password to retry, or press Ctrl+C to stop.' >&2
  done
}
