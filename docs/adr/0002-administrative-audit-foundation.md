# Administrative audit foundation

## Context

The existing tenant-local `audit_event` requires a tenant and cascades on tenant, recipe or revision deletion. Its UUID request identifier also differs from Fastify's string request IDs. Administrative investigations and destructive actions need attributable history after resource removal, including actions against accounts or the instance.

## Decision

Introduce a separate normalized administrative event table through an additive production migration. Preserve the existing tenant-local table and its deletion semantics. Store an event UUID, database-generated timestamptz, actor principal identity, action, target type and stable public UUID, optional parent cookbook, revision and media public UUIDs, required purpose/reason, minimal previous/new state, a text request correlation identifier, optional report public UUID and outcome.

Resource identifiers in historical events describe the event at occurrence time. They must not cascade with live targets. Actor identity must survive account/principal removal without preventing it; retain the historical principal UUID without a deletion-coupled FK. Avoid email/display-name snapshots by default. Report correlation must remain interpretable after report removal. These event facts are not synchronized copies of mutable profile or recipe data; no denormalized live-resource columns are required.

A shared service must authorize explicit sensitive operations with `instance:administer`, validate the reason and correlation, and write mutation events in the same transaction as the state change. Sensitive reads must persist their event before returning content. Ordinary tenant permissions remain independent. Failed and denied attempts must be observable through structured security logging without logging private request contents. The design must fail closed if required audit persistence fails.

No ordinary-user event editing/deletion endpoint will be provided. Database operators remain trusted; the design does not promise technical immutability against them. Retention is finite: a database policy defaults to 365 days and permits an operator-selected period of 1 through 3,650 days. Startup and periodic pruning enforce that policy; the operator controls backup expiry and pruning after restoration. A shared current policy avoids duplicating retention configuration in every event. No perpetual identifying snapshots or behavioral telemetry are authorized by this decision.

## Consequences

Subsequent administrative operations can share one authorization, purpose and audit boundary without granting cookbook membership. Existing tenant-local audit events retain their meaning. Operation-service and migration tests cover the retention mechanism and privileged access boundary, schema constraints, transaction rollback, deletion survival and string request-ID correlation. The shared services do not change established administrative route permissions; each adopting feature must supply its own scoped target lookup and contract. Historical tenant-creation rows will not be relabelled as justified sensitive administrative events.
