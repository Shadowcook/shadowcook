# Recipe moderation query boundary

## Context

Ordinary recipe reads and writes span reader, editor, revision, share, media, export, report and AI operations. Administrative inspection must still resolve restricted records. Recipe trash and visibility have distinct meanings and cannot represent a platform moderation block.

## Decision

Store moderation as a nullable timestamp on the canonical recipe row. Use the PostgreSQL `ordinary_recipe` view for ordinary content queries and writes. It filters recipe moderation and tenant disabled/reset state, preserving existing route-specific permission/visibility/trash checks. The view is automatically updatable and has a check option. No duplicate tenant state or recipe snapshots are stored.

Explicit, justified administrative inspection and moderation use base tables through their dedicated authorization/audit services. The database connection and server implementation remain trusted; this is not isolation against arbitrary base-table SQL. A scoped base-table slug existence query preserves URL reservations without exposing content. Normal readers and writers receive no generic administrator bypass.

## Consequences

Ordinary endpoints share one restriction predicate while retaining their existing behavior for unrestricted resources. Schema/view changes are additive. Moderation and its audit commit atomically; lifting a flag does not alter publication or trash. Purge and image-history pruning skip restricted resources so investigation data remains available. After unrestriction, the original retention rules apply again. Content already downloaded or copied elsewhere is outside the live boundary.
