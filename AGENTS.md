# Agent coding rules

## Project rules

- Code language is English.
- English is the default UI language. Every user-visible UI string, including metadata, accessibility labels, validation feedback, and client-rendered API errors, must be resolved through the UI locale system rather than hardcoded in components.
- Authored recipe content remains in the language entered by its author and must not be translated by the UI locale system.
- Modularize code. Do not put everything in one big file. Make code reusable where it makes sense.
- All relevant architectural decisions must be documented in `docs/ARCHITECTURE.md`. Never write down reason or explain. Only hard facts. No need to track or comment changes.
- Implementation progress must be documented in `docs/implementation_progress.md`.
- Not every bugfix needs to be tracked in `docs/implementation_progress.md`. Rather track the feature implementation only against the `docs/ARCHITECTURE.md`.
- The API contract must be complete and up to date in `contracts/openapi.yaml`. Any implemented API route, request body, response body, authentication scheme, or changed field must be represented there without gaps.
- Log times must always be UTC, never the local time zone. However, time stamps in the UI can be displayed in the users preferred time format. But the backend or logfile must always have UTC time.
- Do not display unnecessary trailing decimal places in the UI.
- All relational database schemas MUST satisfy at least Third Normal Form (3NF). Intentional denormalization is permitted only when explicitly required by the architecture or an ADR and must be documented with its rationale and consistency guarantees. An implementation agent must not introduce denormalized columns merely to avoid joins or simplify queries.
- Do not use type inference if not absolutely necessary
- Never start the project on your own. You can test on different ports or in sandboxes. But not in a way that the dev DB or ports configured by the dev environment are affected
- All items have to be "deep-linkable". Each category, each recipe should be reflected in the URL
- Write clean code! Not everything in one line! Readability and Style: Use clear naming rules, consistent spacing, and proper indentation so other humans can read the code like a book.
- UI pictograms must use simple, stylized, and immediately distinguishable silhouettes. Prefer a few bold geometric strokes over detailed or realistic representations.

## Personal developer preferences

If `personal_agents.md` exists in the repository root, read it and apply it as local developer preference guidance. Personal preferences must not override the project rules above.
This file will not be checked in into the repository. Therefore, check the local file system for it, not the repo!

## Delivery mode: BETA-3

- Leave the initial SQL-Script untouched (0001_initial_schema.sql)
- Create new schemas after the following pattern:
  - Delivery mode BETA-1:
    - 0002_beta-1.sql
    - do not touch 0001_initial_schema.sql
  - Delivery mode BETA-2:
    - 0003_beta_2.sql
    - do not touch 0001_initial_schema.sql
    - do not touch 0002_beta-1.sql
  - and so forth in this fashion
- once, the delivery mode is "Production", we will create update scripts per each change.
