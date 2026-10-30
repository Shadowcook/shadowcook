# Agent coding rules

## Project rules

- Code language is English.
- English is the default UI language. Every user-visible UI string, including metadata, accessibility labels, validation feedback, and client-rendered API errors, must be resolved through the UI locale system rather than hardcoded in components.
- Authored recipe content remains in the language entered by its author and must not be translated by the UI locale system.
- Modularize code. Do not put everything in one big file. Make code reusable where it makes sense.
- The API contract must be complete and up to date in `contracts/openapi.yaml`. Any implemented API route, request body, response body, authentication scheme, or changed field must be represented there without gaps.
- Log times must always be UTC, never the local time zone. However, time stamps in the UI can be displayed in the users preferred time format. But the backend or logfile must always have UTC time.
- Do not display unnecessary trailing decimal places in the UI.
- All relational database schemas MUST satisfy at least Third Normal Form (3NF). Intentional denormalization is permitted only when explicitly required by the architecture or an ADR and must be documented with its rationale and consistency guarantees. An implementation agent must not introduce denormalized columns merely to avoid joins or simplify queries.
- Do not use type inference if not absolutely necessary
- Never start the project on your own. You can test on different ports or in sandboxes. But not in a way that the dev DB or ports configured by the dev environment are affected
- All items have to be "deep-linkable". Each category, each recipe should be reflected in the URL
- Write clean code! Not everything in one line! Readability and Style: Use clear naming rules, consistent spacing, and proper indentation so other humans can read the code like a book.
- UI pictograms must use simple, stylized, and immediately distinguishable silhouettes. Prefer a few bold geometric strokes over detailed or realistic representations.
- Radio buttons must always be presented as a clearly labelled group of two or more mutually exclusive options. Never render an isolated radio button; use a checkbox for an independent boolean option.
- Radio buttons must always be displayed to the left of their caption.
- Use the `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, and `@fortawesome/react-fontawesome` packages for Font Awesome pictograms in the web application. Do not copy Font Awesome SVG files into application assets.
- `/assets/fontawesome` is a local reference library for finding icon candidates. If no matching icon exists, create a custom SVG.
- Alert/Confirmation popups must never be browser-native `alert()`. Always use Project native dialog box
- `apps/api/skills` is only for agents that create recipes on the deployed system. It is not for development purposes.

## Documentation rules

- `docs/ARCHITECTURE.md` describes only implemented capabilities, current behavior, data rules, interfaces, and security boundaries. Verify claims against the local implementation. Schema tables, dependencies, or scaffolding alone do not constitute an implemented capability.
- Keep the architecture factual and organized by topic. Do not include design rationale, change tracking, implementation status, release plans, speculative designs, or unimplemented requirements. Document required design rationale in a separate ADR; the architecture records the resulting facts and consistency guarantees.
- The architecture is neither an ADR nor a change tracker. Update existing capability descriptions in place to state the current behavior. Do not append dated entries, implementation narratives, before/after comparisons, decision histories, alternatives, or justifications. Record required decision rationale in separate ADRs and feature implementation history in `docs/implementation_progress.md`.
- `docs/roadmap.md` is the single collection of unimplemented capabilities, outstanding requirements, and feature ideas. Keep all items under one `Backlog` section. Do not assign priorities, releases, milestones, or delivery dates unless the user establishes a concrete plan.
- Merge overlapping backlog items and preserve their requirements. Do not recreate a separate `feature_ideas.md` or duplicate future feature specifications in the architecture.
- When implementing a backlog item, document the delivered behavior in the architecture and remove the completed scope from the backlog in the same task. For partial implementations, document only the working capabilities in the architecture and retain the outstanding scope in the backlog.
- When a capability is removed or disabled, update its architecture description. Keep any intended future implementation in the backlog.
- Document feature implementation progress in `docs/implementation_progress.md` against the corresponding architecture capabilities. Routine bugfixes and documentation-only changes do not require feature progress entries. Keep implementation history out of the architecture and roadmap.
- Keep documentation links and heading anchors valid when moving or renaming content. Update affected references and check formatting. Avoid duplicate capability descriptions and stale chapter-number references.

## Personal developer preferences

If `personal_agents.md` exists in the repository root, read it and apply it as local developer preference guidance. Personal preferences must not override the project rules above.
This file will not be checked in into the repository. Therefore, check the local file system for it, not the repo!

## Delivery mode: BETA-2

- Every migration filename timestamp uses the UTC time at creation in the exact `YYYYmmddHHiiss` format, for example `20261006232324`.
- Create new schemas after the following pattern:
  - Delivery mode INITIAL_DRAFT:
    - <timestamp>_initial_schema.sql
    - do not create new migration files while working in this mode
  - Delivery mode BETA-1:
    - <timestamp>_beta-1_<description>.sql
    - do not touch *_initial_schema.sql
  - Delivery mode BETA-2:
    - <timestamp>_beta_2_<description>.sql
    - do not touch *_initial_schema.sql
    - do not touch _*beta-1*_.sql
  - and so forth in this fashion
- once, the delivery mode is "Production", we will create update scripts per each change.
