# Consolidated schema baseline

## Context

The final deployed Beta database already contains the schema produced by the initial migration and 23 Beta migrations. There is one production database. A new installation needs the resulting schema, without intermediate data transformations for earlier Beta states.

## Decision

Replace the previous SQL migration chain with `20261030204936_initial_schema.sql`. Define final columns, constraints, indexes, functions, and built-in seed records directly. Keep the separate initial-deployment unit seed and the existing migration runner with its identifier and checksum validation.

The existing production database requires a one-time manual ledger alignment after a backup and while the application is stopped. Its schema and application data remain in place. Replace the old ledger records with the new baseline identifier and SHA-256 checksum in one transaction. Do not execute the baseline SQL against the existing database. This repository change does not perform that production operation or add automatic adoption of earlier Beta databases.

## Consequences

Fresh installations apply one initial migration. Existing Beta installations cannot start this version until their ledger has been aligned with the equivalent schema. Earlier Beta upgrade scripts are no longer distributed. Later schema changes use separate migrations; applied SQL files remain immutable.

Equivalence is checked by comparing the old migration chain with the consolidated script in isolated PostgreSQL databases, including columns, defaults, constraints, indexes, functions, triggers, extensions, permissions, instance roles and grants, legal documents, and report/media settings.
