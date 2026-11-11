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
The first command performs read-only connection, identity, and target checks.
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
or command-line arguments. The password is checked against the source instance's
minimum-entropy setting before copying, and against the copied policy when applied
using the application's password hashing. Cancellation or invalid file/stdin input
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

Use a source account with only CONNECT, schema USAGE, and SELECT on all tables
and sequences. The target database must already exist and be dedicated to testing,
with application objects only in `public`. Its account needs CREATEDB, CREATE on
the target database, and ownership of its public schema. Stop target API, web,
and other database clients before running the script; other target connections
and additional application schemas are rejected. The production application can
continue running during the source export.

Execution creates a consistent full dump, restores it into a randomly named
working database on the target server, sanitizes it, and exports the resulting
copy. Business data is compared before and after sanitization for every retained
table. A sanitization or validation failure leaves the target untouched. Publication
replaces the entire target `public` schema in a single transaction, including
removing stale objects from older test versions. A publication error rolls back
the schema removal and import. Stop clients throughout this process; the script
does not prevent operators from starting them again while it runs. The source
schema and migration ledger are copied as stored; the clone tool does not migrate
the copy. Start the new application version only after the clone succeeds.

The sanitization policy is:

- Every user, including disabled and deleted users, retains its IDs, timestamps,
  status, roles, memberships, ownership, and author relationships. Ordered by
  `created_at, id`, names become `User 1`, `User 2`, etc., and addresses become
  `user1@local`, `user2@local`, etc. First/last names, password hashes, and password
  change timestamps become SQL NULL; required password changes are cleared.
- Sessions, password resets, email codes, pending registrations and email changes,
  invitations, authentication rate events, API tokens, OAuth registrations and
  credentials, AI grants, recipe share links, tenant access grants, and tenant
  cryptographic keys are removed. Service accounts and their role relationships
  remain, without their API tokens.
- SMTP configuration is removed and the report recipient is set to NULL. Reports
  and their notification queue are retained. Mail delivery is unavailable until
  test SMTP is explicitly configured. Use a mail capture service when testing
  delivery: unchanged free-text content and templates can contain real addresses.
- Recipes, revisions, catalogues, cookbook names, free text, reports, audit JSON,
  media references, provenance, and all other retained business data remain as
  stored. This is a test-data clone, not comprehensive personal-data anonymization.

The working database and private temporary dumps are removed on success and
ordinary failures. Failed runs retain private diagnostics under the printed
temporary path, without dump/restore SQL files. If database cleanup fails, the
script prints the working database name for manual removal. A host crash or
SIGKILL can also leave working data behind. Temporary copies contain production
data. No credentials are printed by the script; diagnostics can contain database
content. All script log timestamps use UTC.

Keep the target instance's own `INSTANCE_SECRET_KEY`; the production key is not
needed because operational secrets and tenant private keys are removed.
The final step sets the entered password for every imported user, including disabled
and deleted users, and creates an additional local `admin@local` user with the existing
`administrator` role and the same password. It sets password-change timestamps to the
current time and clears mandatory password changes. Imported account statuses,
principals, roles, and business relationships are preserved; disabled and deleted
accounts remain unavailable for login.
The local account can sign in immediately without a mandatory password change.
Repeating the administrator helper updates the existing active `admin@local`
instead of adding another account. Every run resets all user passwords and revokes
all existing user sessions. Password setup and role assignment share a transaction. An email-code-only authentication
setting is changed to password-or-email-code so the local password can be used;
other authentication settings remain as copied.

If applying the password fails after the target import, the script returns an error
without rolling back the already imported data. Keep the target services stopped
until password setup is complete.
Email-code testing requires test SMTP. Recipe image files are outside the database:
copy them separately into
the target's own media volume, preserving storage keys. Never share a writable
media volume with production.
