# Shadowcook Docker deployment

The deployment package builds Shadowcook directly from Git. Docker resolves
`SHADOWCOOK_SOURCE_REPOSITORY_URL#SHADOWCOOK_SOURCE_REF`, installs the locked
workspace dependencies, builds the database package, API, and web application,
then creates separate API and web runtime images. Runtime images contain only
production dependencies and build output.

Create a server-copyable package from a repository checkout with:

```bash
pnpm package:deployment
```

The command writes `dist/shadowcook-deployment-<version>.tar.gz`. Its contents
are the Dockerfile, Compose configurations, `.env.example`, `upgrade.sh`, and
this guide.
Extract the archive on the server, then continue in its top-level directory.

`apache.reverse-proxy-example.conf` proxies HTTPS traffic to the bundled web
listener. Enable Apache's `headers`, `proxy`, `proxy_http`, `rewrite`, and
`ssl` modules, replace the example hostname and certificate paths, then set
`PUBLIC_WEB_ORIGIN` to the same HTTPS origin in `.env`.

## Bundled PostgreSQL

Copy `.env.example` to `.env`, replace the PostgreSQL password, and set the
public origin. Set `DATABASE_URL` to the matching bundled PostgreSQL connection
string. URL-encode reserved characters in connection-string credentials. Create
the Docker secret before starting the stack:

```bash
cp .env.example .env
mkdir -p secrets
openssl rand -base64 32 > secrets/instance_secret_key
chmod 600 secrets/instance_secret_key
./upgrade.sh main
```

The bundled database persists in the `postgres-data` Docker volume. The web
application is available at `SHADOWCOOK_HTTP_BIND:SHADOWCOOK_HTTP_PORT`.
The API is internal to Compose. Keep the default loopback binding when a host
reverse proxy provides HTTPS.

The API applies migrations and the initial deployment seed before its health
check becomes healthy. The web container waits for that check.

## Existing PostgreSQL

Set `COMPOSE_FILE=compose.external-postgres.yaml` in `.env` and set
`DATABASE_URL` to the connection string for the existing PostgreSQL database.
The connection user must be able to create and migrate Shadowcook tables. Do
not set bundled PostgreSQL credentials as a substitute for `DATABASE_URL` in
this mode.

Upgrade either deployment mode by passing a branch, tag, or commit hash:

```bash
./upgrade.sh v0.1.0
```

The script fetches the requested Git ref, resolves its commit, and stores the
full commit hash in both `SHADOWCOOK_SOURCE_REF` and `SHADOWCOOK_BUILD_COMMIT`.
It passes the commit explicitly to the Docker Compose build, rebuilds both
application images, and recreates changed containers. The web footer displays
that commit. If the build or container update fails, the script restores the
previous `.env` file. Use a full commit hash or immutable release tag for
repeatable production deployments.

`INSTANCE_SECRET_KEY_FILE` is mounted only as a Docker secret. Keep that file
outside version control and retain the same key with database backups: it is
required to decrypt operational secrets stored in PostgreSQL.
