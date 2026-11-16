# Production data for testing

Run the database clone tool from a development checkout. Its script and helpers
remain under `scripts/`; they are not included in the deployment package.
From the repository root, prepare the configuration:

```bash
cp .env.db-clone.example .env.db-clone
chmod 600 .env.db-clone
```

Set `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL` in `.env.db-clone`.
The configuration contains literal values, not executable shell expressions,
and is ignored by Git. Then validate or execute the clone:

```bash
pnpm clone:db
pnpm clone:db --execute
```

Use `--env-file /path/to/.env.db-clone` to select a different configuration.
The first command performs read-only connection, identity, source-extension, and
target CREATEDB checks.
It does not simulate replacement or validate every schema dependency.
With `--execute`, the password is read and validated after the initial read-only
checks, before exporting data or creating the working database. If `./clone-secret`
exists in the current working directory, its single non-empty password line is used
without a prompt (a final newline is optional). The file takes precedence over
`--admin-password-stdin`. Keep this local file private, for example with
`chmod 600 clone-secret`; it is ignored by Git.

Otherwise, the script asks twice for a hidden shared test password for all users,
including `admin@local`. Confirmation mismatches and rejected passwords can be
retried. Execution requires installed workspace dependencies (Node.js and the API's
`tsx` runtime). An interactive terminal is required only when neither the file nor
`--admin-password-stdin` supplies the password. The latter reads one password line
from standard input without confirmation. Do not put the password in `.env.db-clone`
or command-line arguments. Clone passwords are exempt from the configured
minimum-entropy threshold in both source and target, including when the helper
runs with `NODE_ENV=production`. Non-empty passwords of up to 1024 characters
are accepted and use the application's scrypt hashing. Regular application
password policies remain unchanged. Cancellation or invalid file/stdin input
leaves both databases unchanged. Without `--execute`, no password is read.

Only `--execute` creates working data or replaces the target. Source and target
must be different databases; aliases referring to the same database are rejected
using the actual database OID, name, and server start time.

Install `psql`, `pg_dump`, `pg_restore`, `createdb`, and `dropdb` on the development host.
Use client tools matching the server major version, and compatible source and
target PostgreSQL versions and extensions. Both URLs must be reachable from
the development host; for local bundled Compose databases use their published
loopback ports. Remote databases require a reachable endpoint or a tunnel.
The script does not execute inside containers or start/stop services.
Use an explicit database path and one host per URL. Percent-encode reserved URL
characters; query parameters support TLS, GSS, channel binding, connection timeout,
and application name, but cannot override connection routing or database names.

Use a source account with only CONNECT, USAGE on `public`, and SELECT on its
tables and sequences. The target database must already exist, with its `public`
schema reserved for the Shadowcook test copy. Additional schemas are allowed in
both databases. Source schemas outside `public` are not exported; target schemas
outside `public` and their objects are preserved. The source reader needs no
access to unrelated schemas. Extensions installed in source `public` are discovered
from its catalogs and included; the tool does not require a particular extension.
Extensions installed outside `public` are not exported. Public objects depending on excluded source objects can cause staging
to fail, leaving the target unchanged.

The target account needs CREATEDB, CREATE on the target database, and ownership
of its public schema, plus permission to install the copied extensions. Missing CREATEDB is
reported before password entry or source export. A database administrator can
run `ALTER ROLE target_role CREATEDB;` on the target server, using the role from
`TARGET_DATABASE_URL`, or provide a target account that already has this privilege.
Stop target Shadowcook API, web, and other clients using `public` before execution. Clients
using unrelated schemas may remain connected. Connections cannot reliably be
assigned to a single schema, so the tool does not reject them by connection
count. Conflicting locks during publication cause failure after a 10-second
lock timeout; the tool does not terminate other sessions. Avoid concurrent DDL
affecting `public` or its dependencies throughout cloning. The production
application can continue running during the source export.

Execution creates a consistent dump of `public` and its installed extensions, restores it into
a randomly named working database on the target server, sanitizes it, and exports
the resulting copy. Business data is compared before and after sanitization for every retained
table. A sanitization or validation failure leaves the target untouched. Publication
replaces the entire target `public` schema in a single transaction, including
removing stale objects from older test versions and other extensions installed
in target `public`. A publication error rolls back the schema removal and import.
Within the same transaction, the tool records
other schemas' object dependencies, including owned constraints, defaults,
columns, view rules, and extension members. After replacement it verifies that
these dependencies and schemas still exist. If `CASCADE` or import would remove
or damage an external object, the transaction is rolled back. For example, a
view or foreign key in another schema referencing a replaced table prevents
publication. These checks require no superuser privileges. References stored
only in function strings or application SQL are not tracked by PostgreSQL's
dependency catalog; operators must account for such references separately.
Stop Shadowcook clients throughout this process; the script does not prevent
operators from starting them again while it runs. The source schema and migration
ledger are copied as stored; the clone tool does not migrate the copy, validate
migration IDs or checksums against the checkout, or create missing application
objects. Old schemas can be cloned for upgrade testing. Start the new application
version only after cloning; migration is a separate subsequent action.

Cleanup examines the copied catalogs instead of requiring the checkout's current
schema. Known cleanup operations apply only to existing, writable columns and
existing tables. Missing optional fields and feature tables are skipped. Unknown
tables and columns are retained, including their constraints and data; the tool
cannot infer the meaning of unknown credentials or personal fields. Schema and
constraint incompatibilities that prevent an applicable cleanup operation still
cause a failure in staging, leaving the target unchanged.

The sanitization policy is:

- Every user, including disabled and deleted users, retains its IDs, timestamps,
  status, roles, memberships, ownership, and author relationships. Ordered by
  available `created_at` and `id` columns, names become `User 1`, `User 2`, etc.,
  and addresses become `user1@local`, `user2@local`, etc.; physical row order is the
  fallback when those ordering columns are absent. Nullable first/last names and
  password fields are cleared where present. Required first/last names use
  numbered placeholders. Existing password hashes are replaced during password
  setup, and required-password-change flags are cleared where present.
- Sessions, password resets, email codes, pending registrations, email changes and administrative email-recovery proofs,
  invitations, authentication rate events, API tokens, OAuth registrations and
  credentials, AI grants, recipe share links, tenant access grants, and tenant
  cryptographic keys are removed. Service accounts and their role relationships
  remain, without their API tokens.
- Existing SMTP configuration is removed. An existing report-recipient column is
  set to NULL when nullable, or `reports@local` when required. Reports
  and their notification queue are retained. Mail delivery is unavailable until
  test SMTP is explicitly configured. Use a mail capture service when testing
  delivery: unchanged free-text content and templates can contain real addresses.
- Recipes, revisions, catalogues, cookbook names, free text, reports, audit JSON,
  media references, provenance, and all other retained business data remain as
  stored. This is a test-data clone, not comprehensive personal-data anonymization.

The working database and private temporary dumps are removed on success and
ordinary failures. Failed runs print the failed phase, exit code, and the path
to a private `tools.log` on standard error, even when the failed tool's output was
redirected. Read that file for the underlying PostgreSQL error. Failed runs retain
these private diagnostics without dump/restore SQL files. If database cleanup
fails, the script prints the working database name for manual removal. A host crash or
SIGKILL can also leave working data behind. Temporary copies contain production
data. No credentials are printed by the script; diagnostics can contain database
content. All script log timestamps use UTC.

Keep the target instance's own `INSTANCE_SECRET_KEY`; the production key is not
needed because operational secrets and tenant private keys are removed.
Before publication, the entered password is applied in the working database to
existing writable `user_account.password_hash` fields, including disabled and
deleted users. Available password-change timestamps become the current time;
available mandatory-change flags are cleared. Password setup uses the shared
scrypt encoding without entropy validation. Existing user sessions are removed.
These operations do not require the current application's optional columns.

When the copied principal/account/role model supports it and contains the
`administrator` role, the helper creates an additional `admin@local` account with
the same password. An existing active local account is updated instead of
creating another. Unknown required columns without defaults are not invented;
if they or an absent identity model prevent local administrator creation, the
helper reports that this step was skipped and retains the copied schema.
Imported account statuses and relationships are preserved. Email-code-only login
is changed to password-or-email-code only when the existing authentication table
and its constraints support that setting. No authentication table is created.

Password setup and local role assignment share a transaction in the working copy.
A failure leaves the target untouched. Only after cleanup and password setup
succeed is the prepared copy exported and published. Neither missing login
features nor an absent administrator model cause the tool to upgrade the schema.

Email-code testing requires test SMTP. Recipe image files are outside the database:
copy them separately into
the target's own media volume, preserving storage keys. Never share a writable
media volume with production.
