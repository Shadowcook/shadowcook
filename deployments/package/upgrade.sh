#!/usr/bin/env sh

set -eu

usage() {
  printf '%s\n' "Usage: $0 <git-ref>" >&2
  exit 64
}

if [ "$#" -ne 1 ]; then
  usage
fi

git_ref=$1
case "${git_ref}" in
  '' | -* | *"
"*)
    printf '%s\n' 'The Git ref must be a non-empty branch, tag, or commit hash.' >&2
    exit 64
    ;;
esac

deployment_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
environment_file="${deployment_directory}/.env"

if [ ! -f "${environment_file}" ]; then
  printf '%s\n' "Missing ${environment_file}. Copy .env.example to .env and configure the deployment first." >&2
  exit 66
fi

source_repository_url=$(awk -F= '
  $1 == "SHADOWCOOK_SOURCE_REPOSITORY_URL" {
    value = substr($0, index($0, "=") + 1)
  }
  END {
    sub(/\r$/, "", value)
    print value
  }
' "${environment_file}")

if [ -z "${source_repository_url}" ]; then
  printf '%s\n' 'SHADOWCOOK_SOURCE_REPOSITORY_URL must be set in .env.' >&2
  exit 65
fi

temporary_directory=$(mktemp -d)
environment_backup="${temporary_directory}/.env"
upgrade_completed=false

cleanup() {
  if [ "${upgrade_completed}" != true ]; then
    cp "${environment_backup}" "${environment_file}"
  fi
  rm -rf "${temporary_directory}"
}

cp "${environment_file}" "${environment_backup}"
trap cleanup EXIT HUP INT TERM

git init --bare --quiet "${temporary_directory}/repository.git"
git -C "${temporary_directory}/repository.git" fetch --quiet --depth=1 "${source_repository_url}" "${git_ref}"
build_commit=$(git -C "${temporary_directory}/repository.git" rev-parse --verify 'FETCH_HEAD^{commit}')

case "${build_commit}" in
  *[!0123456789abcdef]* | '')
    printf '%s\n' 'The resolved Git ref is not a commit.' >&2
    exit 65
    ;;
esac

update_environment_value() {
  key=$1
  value=$2
  output_file="${temporary_directory}/environment"

  awk -v key="${key}" -v value="${value}" '
    BEGIN {
      updated = 0
    }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    {
      print
    }
    END {
      if (updated == 0) {
        print key "=" value
      }
    }
  ' "${environment_file}" > "${output_file}"

  mv "${output_file}" "${environment_file}"
}

update_environment_value SHADOWCOOK_SOURCE_REF "${build_commit}"
update_environment_value SHADOWCOOK_BUILD_COMMIT "${build_commit}"

cd "${deployment_directory}"
docker compose build --build-arg "SHADOWCOOK_BUILD_COMMIT=${build_commit}"
docker compose up --no-build -d

upgrade_completed=true
printf '%s\n' "Upgraded Shadowcook to ${build_commit}"
