# Legacy cookbook migration

The one-way migration is a separate local workspace application under `apps/migration`. It is not started by the API and is not included in the runtime deployment images. It reads categories and recipes from the legacy HSQLDB database and inserts them into one empty Shadowcook 2 tenant. It never reads the legacy user tables. The HSQLDB connection is set to read-only before cookbook queries run.

## Required configuration

Copy `.env.migration.example` to the untracked `.env.migration` file and configure both database endpoints:

```dotenv
SOURCE_DB_URL=jdbc:hsqldb:hsql://legacy-host/database
SOURCE_DB_USERNAME=read-only-user
SOURCE_DB_PASSWORD=read-only-password

TARGET_DB_URL=postgresql://localhost:5432/shadowcook
TARGET_DB_USERNAME=shadowcook
TARGET_DB_PASSWORD=change-me
TARGET_DB_TENANT_SLUG=target-tenant
```

The target tenant must already exist, have no categories or recipes, and have exactly one principal assigned to its `Owner` role. The Owner becomes the author of every imported revision.

`TARGET_DB_URL` contains the PostgreSQL endpoint and database name. `TARGET_DB_USERNAME` and `TARGET_DB_PASSWORD` provide the target database credentials separately.

Set `TARGET_DB_AUTHOR_PRINCIPAL_ID` to a target-tenant member's principal ID when the author must differ or the tenant has more than one Owner.

Java 21 or later and the HSQLDB JDBC driver are required. The application discovers the newest driver in the local Maven repository. `SOURCE_DB_HSQLDB_JAR` can name a driver JAR explicitly.

The application reads only `.env.migration`. It does not load the API's `.env` or the local `.env.codex` file. Process environment variables may provide the same settings.

The target PostgreSQL connection attempt times out after 15 seconds.

## Run

The command defaults to a full transactional dry run. The transaction is rolled back after all target constraints have been checked.

```sh
pnpm migrate:production-cookbook
```

Review the reported row counts and substitutions. Commit the import with:

```sh
pnpm migrate:production-cookbook --execute
```

The committed migration is one transaction and locks the target tenant. A second run fails because the target tenant is no longer empty.

## Mapping

- The legacy technical `ROOT` category is omitted. Its children become top-level categories.
- Category and recipe slugs are generated deterministically from authored names. The legacy numeric ID is added for reserved or duplicate slugs.
- Every legacy recipe becomes one published revision with one visible default variant.
- Legacy usages with a real unit create tenant-owned ingredients or reuse matching instance- or tenant-owned ingredients. The ingredient name is the authored text before the first comma and outside parentheses. Parenthetical text and text after the first comma become the authored usage note.
- Standard legacy units map to the instance unit catalogue. Missing legacy units are created as tenant-owned units.
- Legacy negative unit identifiers and unit identifier `0` map to semantic special-entry kinds.
- A missing step instruction is represented by an em dash. A missing special-entry label is represented by its legacy special-unit label. Both substitutions are counted.
- Legacy thumbnail references are counted but not imported. The current application schema defines media records, but media storage and ingestion are not implemented.
