# ADR 0004 — Administrative account and deletion safety

Status: Accepted

## Context

Permanent deletion must preserve attributable administrative history while removing live content and media safely. Concurrent administrators must not disable or demote the final usable administrator. Account deletion must not race with cookbook creation. An email correction changes the recipient of future authentication messages and therefore requires more than an operator-entered address.

## Decision

Prepare scoped deletion under resource locks and insert its independent administrative event before applying physical deletion in the same transaction. Require count review, exact UUID confirmation and an explicit preservation review. Reuse recipe purge semantics and its durable media-deletion queue; preserve shared assets and reject cross-cookbook references before deleting cookbook-owned media. Retention of backups and external copies remains an operator responsibility.

Serialize sensitive account mutations with a transaction advisory lock acquired before administrative actor row locks. Validate that an active human administrator retains a configured usable login method after the change. Row locks on accounts/principals serialize new canonical ownership against deactivation/deletion; reject account deletion until all canonical ownership is resolved. Independent cookbook service accounts remain separate security identities.

Require an independently verified recovery claim and an expiring random token sent only to the proposed new address. Store only a SHA-256 token hash in a normalized ephemeral relation bound to the target account, requesting administrator and address. The recipient confirms through a one-hour single-use link without an administrator session or subsequent operator action. The old address stays valid until confirmation; the public completion endpoint authorizes only the exact persisted request through token possession. This keeps mailbox proof separate from the operator's entitlement decision. Completion consumes pending proof and revokes account-bound access in the audited transaction. Send prior/new-address notices after commit and return initial link-delivery outcomes; log completion-notification failures without rolling back committed corrections when mail fails.

## Consequences

The advisory lock intentionally serializes infrequent sensitive account actions across the instance; acquiring it before actor locks avoids opposing self/other-account operations deadlocking in that flow. SMTP configuration establishes whether the login method is configured, not guaranteed external delivery. Operators must keep another working administrator available before planned access removal.

The proof is a credential: it is absent from API responses, audit state and safe logs, expires after one hour, and is removed from database clones. A resend cooldown limits accidental repeated sends; requesting a replacement invalidates the prior proof. Mailbox proof alone does not establish entitlement; the administrator establishes it before issuance. There is no notification retry queue, automatic preservation hold or backup erasure capability.

Current interfaces and consistency guarantees are documented under [Destructive operations and account recovery](../ARCHITECTURE.md#destructive-operations-and-account-recovery); the [operator guide](../administrative-audit-operations.md#permanent-content-deletion) describes the required manual checks.
