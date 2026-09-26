# Agent coding rules

## Project rules

- Code language is English.
- English is the default UI language. Every user-visible UI string, including metadata, accessibility labels, validation feedback, and client-rendered API errors, must be resolved through the UI locale system rather than hardcoded in components.
- Authored recipe content remains in the language entered by its author and must not be translated by the UI locale system.
- Modularize code. Do not put everything in one big file. Make code reusable where it makes sense.
- All relevant architectural decisions must be documented in `docs/ARCHITECTURE.md`. Never write down reason or explain. Only hard facts. No need to track or comment changes.
- Implementation progress must be documented in `docs/implementation_progress.md`.
- The API contract must be complete and up to date in `contracts/openapi.yaml`. Any implemented API route, request body, response body, authentication scheme, or changed field must be represented there without gaps.
- Log times must always be UTC, never the local time zone. However, time stamps in the UI can be displayed in the users preferred time format. But the backend or logfile must always have UTC time.
- All relational database schemas MUST satisfy at least Third Normal Form (3NF). Intentional denormalization is permitted only when explicitly required by the architecture or an ADR and must be documented with its rationale and consistency guarantees. An implementation agent must not introduce denormalized columns merely to avoid joins or simplify queries.
- Do not use type inference if not absolutely necessary
- Never start the project on your own. You can test on different ports or in sandboxes. But not in a way that the dev DB or ports configured by the dev environment are affected
- All items have to be "deep-linkable". Each category, each recipe should be reflected in the URL
- Write clean code! Not everything in one line! Readability and Style: Use clear naming rules, consistent spacing, and proper indentation so other humans can read the code like a book.

## Personal developer preferences

If `personal_agents.md` exists in the repository root, read it and apply it as local developer preference guidance. Personal preferences must not override the project rules above.
This file will not be checked in into the repository. Therefore, check the local file system for it, not the repo!

## Delivery mode: INITIAL_DRAFT

- This repository is in INITIAL_DRAFT mode until this section is explicitly removed or replaced.
- The development database, its data, and its migration history are disposable.
- Do not implement legacy compatibility, data preservation, upgrade paths, backfills, compatibility layers, or patch scripts.
- For a changed initial schema, edit the initial schema directly and remove superseded draft migrations instead of adding a transition migration.
- Do not retain existing recipes, tenants, visibility settings, or development data when they conflict with the current draft requirements.
