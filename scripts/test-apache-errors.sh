#!/usr/bin/env bash
# Isolated Apache smoke test: no host ports, host network, Node process or database.
set -euo pipefail
repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_directory=$(mktemp -d)
trap 'rm -rf "${test_directory}"' EXIT
chmod 755 "${test_directory}"
mkdir "${test_directory}/htdocs"
printf '%s\n' '{"code":"TEST_ERROR","error":"Safe upstream payload"}' > "${test_directory}/htdocs/payload.json"
node --input-type=module - "${repository_root}" "${test_directory}" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const [root, directory] = process.argv.slice(2);
const example = readFileSync(`${root}/deployments/package/apache.reverse-proxy-example.conf`, 'utf8');
const start = example.indexOf('    # Standalone outage page:');
const end = example.indexOf('    # Optional custom landing website:');
const directives = example.slice(start, end).replaceAll('/var/www/shadowcook-errors', '/error-assets');
writeFileSync(`${directory}/httpd.conf`, `ServerRoot "/usr/local/apache2"
PidFile /tmp/shadowcook-httpd.pid
ServerName test.local
Listen 8080
Listen 8081
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule unixd_module modules/mod_unixd.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule alias_module modules/mod_alias.so
LoadModule headers_module modules/mod_headers.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule rewrite_module modules/mod_rewrite.so
User daemon
Group daemon
ErrorLog /proc/self/fd/2
LogLevel warn
DocumentRoot "/test/htdocs"
<Directory "/test/htdocs">
  Require all granted
</Directory>
<VirtualHost *:8080>
${directives}
ProxyPass /unavailable http://127.0.0.1:9/
ProxyPass / http://127.0.0.1:8081/
</VirtualHost>
<VirtualHost *:8081>
  RewriteEngine On
${[400,401,403,404,409,413,422,429,500,502,503,504].map(status => `  RewriteRule "^/(?:api/|mcp/|page/)?${status}$" "-" [R=${status},L]`).join("\n")}
  ErrorDocument 400 /payload.json
  ErrorDocument 401 /payload.json
  ErrorDocument 403 /payload.json
  ErrorDocument 404 /payload.json
  ErrorDocument 409 /payload.json
  ErrorDocument 413 /payload.json
  ErrorDocument 422 /payload.json
  ErrorDocument 429 /payload.json
  ErrorDocument 500 /payload.json
  ErrorDocument 502 /payload.json
  ErrorDocument 503 /payload.json
  ErrorDocument 504 /payload.json
  <Files "payload.json">
    ForceType application/json
  </Files>
</VirtualHost>
`);
JS
cat > "${test_directory}/check.sh" <<'SH'
set -eu
httpd -v
httpd -t -f /test/httpd.conf
httpd -f /test/httpd.conf -k start
trap 'httpd -f /test/httpd.conf -k stop' EXIT
# BusyBox wget prints headers on stderr, including non-2xx response headers.
check() {
  path=$1
  expected_status=$2
  expected_text=$3
  wget -S -O /tmp/body --header='Accept: text/html' "http://127.0.0.1:8080${path}" >/tmp/output 2>/tmp/headers || true
  cat /tmp/headers
  test "$(awk '/HTTP\// { print $2; exit }' /tmp/headers)" = "${expected_status}"
  # BusyBox wget discards error bodies: obtain them through a plain TCP request.
  printf 'GET %s HTTP/1.0\r\nHost: test.local\r\nAccept: text/html\r\n\r\n' "${path}" | nc 127.0.0.1 8080 > /tmp/raw
  grep -q "${expected_text}" /tmp/raw
}
check /_errors/50x.html 200 Shadowcook
check /unavailable 503 Shadowcook
grep -qi 'Cache-Control: no-store' /tmp/raw
for status in 500 502 503 504; do
  check "/page/${status}" "${status}" Shadowcook
  grep -qi 'Cache-Control: no-store' /tmp/raw
done
for scope in api mcp; do
  for status in 400 401 403 404 409 413 422 429 500 502 503 504; do
    check "/${scope}/${status}" "${status}" TEST_ERROR
    ! grep -q Shadowcook /tmp/raw
  done
done
printf '%s\n' 'Apache error fallback and API isolation checks passed.'
SH
docker run --rm --network none \
  --mount "type=bind,src=${test_directory},dst=/test,readonly" \
  --mount "type=bind,src=${repository_root}/deployments/package/errors,dst=/error-assets,readonly" \
  httpd:2.4-alpine sh /test/check.sh
