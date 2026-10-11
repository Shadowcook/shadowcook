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
are the Dockerfile, Compose configurations, `.env.example`, `upgrade.sh`, `backup-database.sh`,
`restore-database.sh`, `database-tools.sh`, and
this guide.
Extract the archive on the server, then continue in its top-level directory.

`apache.reverse-proxy-example.conf` proxies HTTPS traffic to the bundled web
listener. Enable Apache's `headers`, `proxy`, `proxy_http`, `rewrite`, and
`ssl` modules, replace the example hostname and certificate paths, then set
`PUBLIC_WEB_ORIGIN` to the same HTTPS origin in `.env`. The HTTPS virtual host
must forward `X-Forwarded-Proto`, `X-Forwarded-Port`, and `X-Forwarded-Host`.

The web listener forwards `/api/*`, `/mcp`, and MCP OAuth discovery requests to
the internal API. With the default `PUBLIC_API_ORIGIN`, configure MCP clients
with `https://<public-host>/api/mcp`. `/mcp` is also forwarded directly and uses
the same canonical OAuth resource metadata. An unauthenticated MCP initialize
request returns HTTP 401 with a `WWW-Authenticate` header pointing to OAuth
metadata.

## Bundled PostgreSQL

Copy `.env.example` to `.env`, replace the PostgreSQL password, and set the
public origin. Create the Docker secret before starting the stack:

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

To require Cloudflare Turnstile for public registration, set both
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` in `.env`, run `docker compose up -d` to
recreate the API container, then enable Turnstile in the registration settings.

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
It passes the commit, Compose project name, and `PUBLIC_WEB_ORIGIN` explicitly to the Docker Compose
build, rebuilds both application images, and recreates changed containers. The
web footer displays that commit. If the build or container update fails, the script restores the
previous `.env` file. Use a full commit hash or immutable release tag for
repeatable production deployments. After every successful recreation, it
removes unused images carrying `net.shadowcook.project=<current-project>`.
`SHADOWCOOK_BUILD_PROJECT` supplies the project name to every Dockerfile stage;
the project label is set before dependency installation, compilation, and runtime
assembly. This includes intermediate images created by the classic Docker builder.
Other projects' images, shared base images such as `node`, and legacy images
without the project label are retained. BuildKit's separate build cache is not
removed by this image cleanup.
The script resolves the project and image names through Compose, rejects image
tags labelled as belonging to another project before building, and verifies both
labels on the built runtime images before it recreates containers.
The requested Git ref must include the deployment
Dockerfile shipped in this package. Intermediate-image cleanup requires the
requested Git ref's Dockerfile to apply `SHADOWCOOK_BUILD_PROJECT` in every stage;
updating the server package alone does not change the Dockerfile fetched from Git.

## Multiple instances on one server

Extract the package into a separate directory for each instance. Each directory
has its own `.env`, secret file, backup directories, and restore logs.
Set a unique `COMPOSE_PROJECT_NAME` in each `.env`. Compose uses it to prefix
container, network, and bundled PostgreSQL volume names. Service names remain
`api`, `web`, and `postgres` within each project's network.

Container names are explicitly `${COMPOSE_PROJECT_NAME}-api`,
`${COMPOSE_PROJECT_NAME}-web`, and, in bundled mode,
`${COMPOSE_PROJECT_NAME}-postgres`, without a numeric suffix. Each service runs
as one container per project; fixed container names do not support scaling a
service to multiple replicas. Changing only this container naming configuration
keeps the existing database volume when the project name stays the same.

The new `.env.example` sets `SHADOWCOOK_IMAGE_TAG=${COMPOSE_PROJECT_NAME}`, so
changing the project name also selects separate application image tags.
When adding an instance using an older `.env`, replace its shared `local` image
tag with a unique tag or the same `${COMPOSE_PROJECT_NAME}` expression.
Application images must be separate even at the same commit when the public
origins differ.

For an existing default deployment and an additional test instance:

| Setting                    | Existing instance                   | Additional instance                 |
| -------------------------- | ----------------------------------- | ----------------------------------- |
| `COMPOSE_PROJECT_NAME`     | `shadowcook`                        | `shadowcook-test`                   |
| `SHADOWCOOK_IMAGE_TAG`     | Keep the existing tag, e.g. `local` | `${COMPOSE_PROJECT_NAME}`           |
| `SHADOWCOOK_HTTP_PORT`     | `4321`                              | `4322`                              |
| `SHADOWCOOK_POSTGRES_PORT` | `5432`                              | `5433`                              |
| `PUBLIC_WEB_ORIGIN`        | `https://cookbook.example.com`      | `https://test-cookbook.example.com` |

Host bind addresses and ports must not overlap. Internal container ports remain
the same. Configure the reverse proxy to send each public domain to its instance's
web host port. With external PostgreSQL, use a separate database per instance;
`SHADOWCOOK_POSTGRES_PORT` only applies to the bundled database.

Generate a separate instance secret for each new instance. Keep the existing
instance's `.env` and secret when replacing deployment package files. Do not
overwrite them with `.env.example` or a newly generated key.

Keep the existing deployment's project name. The default is `shadowcook`;
changing it selects a different database volume and does not move existing data.
Run Compose and upgrade commands from the intended instance's deployment directory.

## Starting containers and applying configuration

After the initial deployment, start the stack or apply changed runtime settings with:

```bash
docker compose up -d
```

Both Compose variants use local API and web images without rebuilding or pulling
them when those images already exist. Missing application images are built from
the configured Git ref. `docker compose down` followed by `docker compose up -d`
also reuses existing images; `down` without `--volumes` retains the bundled
PostgreSQL data volume.

Compose reads the deployment `.env` again and recreates containers whose runtime
configuration changed. `docker compose restart` and `docker compose start` keep
the environment from the existing containers.

Use `./upgrade.sh <git-ref>` for a commit change. Changing only
`SHADOWCOOK_SOURCE_REF` or `SHADOWCOOK_BUILD_COMMIT` in `.env` does not rebuild an
existing image. `PUBLIC_WEB_ORIGIN` is also a build argument: after changing it,
rebuild the images and apply the configuration explicitly:

```bash
docker compose build
docker compose up -d
```

`INSTANCE_SECRET_KEY_FILE` is mounted only as a Docker secret. Keep that file
outside version control and retain the same key with database backups: it is
required to decrypt operational secrets stored in PostgreSQL.

## Database backup

Run the backup script from the deployment directory:

```bash
bash ./backup-database.sh
```

From a repository checkout, use `pnpm backup:db --env-file /path/to/production/.env`.
The local repository `.env` normally selects the development database. Select
the production deployment `.env` explicitly when running outside its directory.
An optional `--output-dir /path/to/backups` changes the destination.

The script requires Bash and `sha256sum` on the host. For bundled deployments,
it uses Docker Compose to execute `pg_dump` and `pg_restore` inside the running
`postgres` service. PostgreSQL client tools are not required on the host. The
Compose file is selected by `COMPOSE_FILE` in the selected `.env`, defaulting to
`compose.yaml` beside that file. The script does not start or recreate containers.
Credentials come from `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
The dump streams directly into the backup directory on the host; archive
validation streams the dump back to `pg_restore` through standard input.

For `DATABASE_URL`, or standalone bundled credentials without a Compose file,
the script uses host `pg_dump` and `pg_restore`. These tools must match the server
major version or a supported newer version. Standalone bundled credentials use
`SHADOWCOOK_POSTGRES_BIND` and `SHADOWCOOK_POSTGRES_PORT`, defaulting to
`127.0.0.1:5432`; all-interface binds use loopback. File values take precedence
over inherited connection settings. Values are single-line literals, optionally
single- or double-quoted; shell commands and variable substitutions are not executed.
Quote values containing `#` and percent-encode reserved URL characters in
`DATABASE_URL`.

Each run creates `backups/YYYYmmddTHHMMSSZ/` beside the selected `.env` using
UTC. It writes a custom-format `database.dump`, its `SHA256SUMS`, an archive
contents listing, and diagnostic logs. New directories and files are accessible
only to the current user. Existing timestamp directories are never overwritten.
Failed backups retain the incomplete dump as `database.dump.partial`; only
successful archive validation produces `database.dump`.

The dump contains the complete database schema and data, including stored
encrypted secrets. Keep the instance encryption key separately for recovery.
Filesystem media and PostgreSQL cluster roles are outside this database backup.
`pg_restore --list` validates the archive directory; it does not perform a
restore test. To verify the checksum, run `sha256sum --check SHA256SUMS` inside
the timestamp directory.

## Database restore

Keep `database-tools.sh` beside both `backup-database.sh` and `restore-database.sh`.
From the deployment directory, first validate a successful backup:

```bash
bash ./restore-database.sh backups/BACKUP_TIMESTAMP
```

This checks the SHA-256 checksum and archive contents without modifying the database.
Partial or empty dumps and backups without their checksum are rejected. Select a
specific `.env` with `--env-file /path/to/production/.env`. In a repository
checkout, use `pnpm restore:db backups/BACKUP_TIMESTAMP` with the same options.

Stop the application services while keeping PostgreSQL running, then execute recovery:

```bash
docker compose stop api web
bash ./restore-database.sh backups/BACKUP_TIMESTAMP --execute
docker compose start api web
```

Run the final command only after a successful restore. The restore script executes
`pg_restore` inside the running `postgres` service for bundled deployments and
does not require PostgreSQL client tools on the host. Existing database objects
represented in the dump and their data are replaced in one transaction using
`--clean --if-exists --single-transaction --exit-on-error`. Objects outside the dump
are retained. Restore errors abort the transaction. Ownership and access grants
are not restored; the configured user owns the restored objects. The existing
instance encryption key must match the backup to decrypt operational secrets.

If the database itself was deleted, append `--create-database` to the execute
command. This creates the `.env`'s `POSTGRES_DB` through the `postgres` maintenance
database before restoring. It fails if the target database already exists.
Creation requires `POSTGRES_*` credentials; external `DATABASE_URL` databases
must be created separately. Database creation is outside the restore transaction,
so failed recovery can leave a newly created database empty. If the Docker volume
was deleted, prepare a running PostgreSQL service with the required database user
before running recovery.

Diagnostics are retained in private `restore-logs/YYYYmmddTHHMMSSZ.XXXXXX/`
directories beside the selected `.env`. The script does not stop, start, or
recreate application or database containers. Check validation does not test a
restore transaction or establish that the target database exists.

For manual recovery into a separately prepared empty database with host client tools:

```bash
pg_restore --exit-on-error --no-owner --no-acl --dbname=RESTORE_DATABASE database.dump
```
