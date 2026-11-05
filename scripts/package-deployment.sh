#!/usr/bin/env sh

set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repository_root}"
package_version=$(node -p "require('./package.json').version")
package_name="shadowcook-deployment-${package_version}"
output_directory="${SHADOWCOOK_DEPLOYMENT_OUTPUT_DIRECTORY:-${repository_root}/dist}"
temporary_directory=$(mktemp -d)

cleanup() {
  rm -rf "${temporary_directory}"
}

trap cleanup EXIT INT TERM

mkdir -p "${output_directory}" "${temporary_directory}/${package_name}"

cp "${repository_root}/deployments/docker/Dockerfile" "${temporary_directory}/${package_name}/Dockerfile"
cp "${repository_root}/deployments/package/.env.example" "${temporary_directory}/${package_name}/.env.example"
cp "${repository_root}/deployments/package/apache.reverse-proxy-example.conf" "${temporary_directory}/${package_name}/apache.reverse-proxy-example.conf"
cp "${repository_root}/deployments/package/nginx.reverse-proxy-example.conf" "${temporary_directory}/${package_name}/nginx.reverse-proxy-example.conf"
cp "${repository_root}/deployments/package/compose.yaml" "${temporary_directory}/${package_name}/compose.yaml"
cp "${repository_root}/deployments/package/compose.external-postgres.yaml" "${temporary_directory}/${package_name}/compose.external-postgres.yaml"
cp "${repository_root}/deployments/package/README.md" "${temporary_directory}/${package_name}/README.md"
cp "${repository_root}/deployments/package/upgrade.sh" "${temporary_directory}/${package_name}/upgrade.sh"
cp "${repository_root}/scripts/backup-database.sh" "${temporary_directory}/${package_name}/backup-database.sh"
cp "${repository_root}/scripts/restore-database.sh" "${temporary_directory}/${package_name}/restore-database.sh"
cp "${repository_root}/scripts/database-tools.sh" "${temporary_directory}/${package_name}/database-tools.sh"
chmod 755 "${temporary_directory}/${package_name}/upgrade.sh"
chmod 755 "${temporary_directory}/${package_name}/backup-database.sh"
chmod 755 "${temporary_directory}/${package_name}/restore-database.sh"

archive_path="${output_directory}/${package_name}.tar.gz"
tar -C "${temporary_directory}" -czf "${archive_path}" "${package_name}"

printf '%s\n' "Created ${archive_path}"
