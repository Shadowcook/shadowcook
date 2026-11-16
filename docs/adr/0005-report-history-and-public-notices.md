# ADR 0005 — Report history and public notices

Status: Accepted

## Context

The existing report result records a human decision without executing enforcement. Operators need to investigate private/restricted targets, correlate actions and communicate an appropriate outcome without disclosing internal notes. Existing administrative audit history has finite retention and must remain attributable after resource deletion.

## Decision

Preserve ticket outcomes as decisions. Audit ticket workflow updates separately, and carry the report UUID into existing explicit administrative actions. Read correlated history through a purpose-gated session-only interface with audit before response. Add normalized unique report/event associations for known scoped historical actions without editing their original records. A current-target context supplies content-free live restriction state and dedicated inspection/recheck paths.

Store public notices in a separate normalized relation with the historical recipient account relationship, recipient role, explicitly authored message, review/contact instructions and delivery outcome. The recipient relationship records the actual selected recipient at creation; it cannot be derived later from changing cookbook ownership. Do not duplicate account profiles, email addresses, cookbook state or private investigation notes. Notice text is not an administrative event snapshot and is not copied from ticket notes.

Require explicit operator confirmation, revalidate the expected recipient and commit notice/audit before attempting SMTP. Notices and enforcement remain independent actions. Use operator-authored contact instructions for human review rather than adding an unauthenticated appeal API. Apply the existing finite audit-retention period to notice content and cascade association rows when their original event is pruned.

## Consequences

Operators can distinguish decisions, successful recorded actions and public communications. Session-only report access deliberately excludes previously accepted OAuth bearer use. Historical event references survive target deletion, while live links disappear safely when targets are unavailable. History-read events remain audited but are excluded from the paginated listing to avoid page growth caused solely by browsing it.

SMTP acceptance is not proof of inbox delivery. A crash between send and outcome persistence can leave an unknown PENDING status; explicit replacement can duplicate mail. There is no automatic retry, notification-timing policy, public appeal portal or automated adjudication. Operators must provide appropriate public wording and monitored review contacts, and publish instance-specific policies. Backups require separately managed retention.

Current behavior is documented under [Report investigation, history and public notices](../ARCHITECTURE.md#report-investigation-history-and-public-notices); the [operator guide](../administrative-audit-operations.md#report-investigation-and-decisions) describes review and delivery procedures.
