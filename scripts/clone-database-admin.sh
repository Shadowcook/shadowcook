#!/usr/bin/env bash

check_clone_admin_requirements() {
  command -v node >/dev/null 2>&1 || fail 'Node.js is required for administrator password setup.'
  clone_api_directory="${script_directory}/../apps/api"
  clone_tsx="${clone_api_directory}/node_modules/.bin/tsx"
  [[ -x "${clone_tsx}" ]] || fail 'Install workspace dependencies before cloning; the API tsx runtime is missing.'
  if [[ "${admin_password_stdin}" != true ]]; then
    [[ -t 0 ]] || fail 'Administrator setup requires a terminal. For automation, use --admin-password-stdin.'
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
  printf '[%s] Target import complete. Set the password for admin@local.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  while true; do
    if [[ "${admin_password_stdin}" == true ]]; then
      IFS= read -r password || fail 'No administrator password was received on standard input. The target was already cloned.'
    else
      printf '%s' 'New password for admin@local: ' >&2
      IFS= read -r -s password || fail 'Administrator setup cancelled. The target was already cloned.'
      printf '\n%s' 'Repeat password: ' >&2
      IFS= read -r -s confirmation || fail 'Administrator setup cancelled. The target was already cloned.'
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
      fail 'Administrator setup failed. The target was already cloned.'
    fi
    printf '%s\n' 'Administrator setup failed. Enter a valid password to retry, or press Ctrl+C to stop.' >&2
  done
}
