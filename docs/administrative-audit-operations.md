# Administrative audit operations

The [administrative audit infrastructure](ARCHITECTURE.md#administrative-audit-infrastructure) records justified service operations. Existing product administration routes do not automatically use it. Historical event identifiers remain after the corresponding account, cookbook, recipe or report is removed; no email/profile snapshot is stored.

## Access and retention

Only trusted operators with database credentials can inspect event rows or change retention. The application exposes no audit-history, event modification/deletion or retention API. Do not grant application users or cookbook owners database access. Database administrators can modify records; this is not an immutable evidence store.

The database policy defaults to 365 days. Select the retention period appropriate for the instance's operational policy before using sensitive administration. Supported values are 1 through 3,650 days; zero/unlimited is rejected. The current policy applies to all stored events, including when the period is reduced. Pruning uses database time, with one day equal to 24 hours; rows strictly older than the cutoff are deleted. The API prunes on startup and every three hours. Failed periodic pruning is logged and retried at the next interval.

From the source workspace, with an explicitly configured operator `DATABASE_URL`:

```sh
npm --prefix apps/api run admin-audit-maintenance -- set-retention-days 365
npm --prefix apps/api run admin-audit-maintenance -- prune
```

With the built API, from its directory:

```sh
node dist/admin-audit-maintenance.js set-retention-days 365
node dist/admin-audit-maintenance.js prune
```

These commands require an already migrated database; they do not load local environment files or migrate automatically. `DATABASE_URL` must be supplied explicitly through the operator's secret/environment mechanism. Keep credentials out of shell history and captured command output. Commands emit UTC JSON success/failure status without echoing connection strings. Check the exit status; failure is nonzero. Setting a shorter period is followed by pruning at the next cleanup or the explicit prune command.

## Backup and restoration

Online pruning does not remove records from existing database backups, snapshots, replicas or exported logs. Operators must apply a finite backup/log expiry policy consistent with their chosen event retention, restrict access to archives and expire older copies under that policy. Backup deletion is operator-managed, not performed by the audit command.

After restoring a backup, verify the retained audit policy and set the current intended period before reopening access. Run pruning explicitly; API startup also prunes before listening. A restore may otherwise revive records already removed from the live database. Preserve any separately authorized preservation process through operator procedures rather than silently disabling all retention.

## Integration boundary

Sensitive endpoint implementations use `executeAdministrativeRead` or `executeAdministrativeMutation` with trusted action and target metadata and client-supplied purpose only. They must perform target/parent scoping, use the supplied database client, and return data through the wrapper after commit. Read callbacks are database read-only. Mutation callbacks share the audit transaction. Never pass recipe snapshots, media, credentials or arbitrary request bodies as audit state, and never put secrets in reasons. Reports are optional references, not authorization to act.

The new wrapper emits safe action/request/outcome logs for denied, invalid-purpose and failed operations. Configure finite security-log retention separately. Product authentication middleware can reject a request before the wrapper runs; such requests retain the ordinary HTTP/authentication logging behavior.
