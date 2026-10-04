# Shadowcook 2.0 implementation progress

## Completed architecture features

### Platform, persistence, and development data

- The pnpm workspace contains the Fastify API, Astro web application, database package, and OpenAPI contract.
- The Docker Compose deployment package includes an upgrade script that resolves a requested Git ref to a full commit before rebuilding the API and web runtime images, embeds that commit in the localized web footer, supports bundled or existing PostgreSQL through separate Compose configurations, includes an Apache reverse-proxy example, and can be created as a versioned server-copyable tarball.
- PostgreSQL uses the initial normalized schema for tenants, principals, roles, catalogues, recipes, immutable revisions, media, audit events, cooking sessions, sharing, federation upstreams, and mappings. The initial schema migration is maintained as a four-digit numbered SQL file.
- API startup runs transactional, advisory-lock-protected migrations with recorded checksums and UTC timestamps before binding its HTTP listener.
- The API exposes the health endpoint and documented API contract.
- Development database migration loads the versioned baseline data after the initial schema migration and before later migrations.
- The tracked initial-deployment seed creates localized instance-owned units, ingredients, and aliases.
- `pnpm reset:shadowcook-db` and its `pnpm reset:dev-db` alias recreate only the `public` schema of the development `shadowcook` database.
- The separate local `apps/migration` workspace application provides `pnpm migrate:production-cookbook`, uses isolated `SOURCE_DB_*` and `TARGET_DB_*` settings from `.env.migration`, and performs a read-only HSQLDB-to-PostgreSQL legacy cookbook migration with required target-tenant selection, Owner author attribution, a transactional dry run, deterministic category and recipe slugs, published revisions, default variants, ordered steps, tenant ingredients created from real-unit usages, authored usage notes from legacy modifiers, semantic special entries, and legacy unit mapping.

### Cookbook, public web, and localization

- The Astro application provides server-rendered, deep-linkable tenant selection, category, recipe, variant, sign-in, and administration routes, with same-origin API forwarding.
- Cookbook overview and recipe-detail APIs provide tenant-scoped published content, category trees, ordered steps, ingredient usages, reader capabilities, and variant resolution.
- Public cookbook access supports public recipes; authenticated users additionally receive accessible tenant recipes.
- Category and recipe slugs are tenant-unique, route segments are reserved in the database, and cookbook navigation supports root recipe URLs, category paths, and breadcrumbs.
- Category management supports hierarchical creation, renaming, reparenting, guarded deletion, and adjacent sibling ordering.
- The web client uses localized English and German UI dictionaries for UI text, metadata, accessibility labels, and API errors; authored recipe text remains unchanged.
- Cookbook code is organized under `apps/web/src/features/cookbook`; shared browser-session and API infrastructure is under `apps/web/src/lib`.
- Direct recipe URLs render semantic recipe content on the Astro server without requiring JavaScript and include canonical Schema.org Recipe JSON-LD with author, categories, ingredients, and ordered steps.
- Public cookbook overview and category URLs render accessible category and recipe links on the Astro server without waiting for a browser session check.
- Public cookbook overview and category pages progressively transition to the hydrated client cookbook after it has loaded its session and cookbook state.
- Server-rendered recipe pages render the resolved `CookbookScreen`; JavaScript-capable browsers hydrate the same component and non-JavaScript clients retain its semantic HTML recipe page.

### Recipe authoring, revisions, and variants

- Recipes use mutable drafts and immutable published revisions, with category assignment, publication, incrementing versions, and draft lists on deep-linkable tenant management routes.
- Recipe editors provide a revision history tab for published and archived snapshots, including metadata, categories, steps, ingredient usages, variants, and changes against the preceding published revision. Historical revisions are read-only and cannot yet be restored.
- Recipe steps contain normalized ingredient usages, free-text overrides, optional values, notes, and semantic special-entry kinds.
- Ingredient preparation and state information is stored as authored free-text usage notes. It is preserved without translation or mapping during federation.
- Ingredient search is delayed and server-backed, searches aliases, and supports creating tenant ingredients during editing.
- Published recipe details render step-oriented ingredients and preparation, special-entry icons, normalized ingredient notes, and aggregated shopping lists.
- Recipe variants have stable keys, direct step membership, one visible default variant, draft APIs, and reader resolution by optional variant slug.
- Recipe creation, draft creation, and the development seed create and preserve default variants, stable step keys, variant keys, and direct step memberships.
- Recipe visibility and discoverability use tenant defaults with inheritable recipe overrides. `PRIVATE`, `MEMBERS_ONLY`, and `PUBLIC` visibility are enforced for recipe reads; `DISCOVERABLE` and `UNLISTED` control cookbook lists while direct links remain access-controlled. Opaque share links grant access to the full published default variant, can have an optional name and UTC expiry, and are listed, copied, and individually revoked from the recipe editor; those actions require the `recipe:visibility-update` permission.

### Catalogues and units

- Instance administration manages instance-owned units with same-dimension conversion validation and usage-aware deletion protection.
- Standard units, ingredients, and aliases use localization keys; administrator-defined catalogue records retain their stored presentation.
- Tenant management provides deep-linkable ingredient, alias, and unit CRUD.

### Authentication, authorization, and administration

- Human password authentication, email-code authentication, opaque HttpOnly sessions, password-change enforcement, password resets, and bootstrap administration are implemented. Password complexity and minimum-length validation apply outside development only.
- Tenant invitation acceptance starts an invited account session, directs it to the assigned cookbook, and supports first-password completion without a current-password field and with localized repeated-password validation.
- One-time email codes are hashed, expiring, rate-limited, and delivered through configured SMTP.
- SMTP configuration is permission-gated, encrypts stored passwords, and supports test delivery.
- Tenant creation is disabled until SMTP delivery is configured, with a localized configuration requirement, server-side `SMTP_REQUIRED` enforcement, and a localized mail-delivery failure message for owner invitations.
- The authorization model includes canonical permissions, instance roles, tenant roles, tenant memberships, tenant-scoped role assignment, and the initial `Owner`, `Editor`, and `Viewer` roles.
- Tenant-Manager and administrator capabilities cover tenant lifecycle management, invitations, users, and role assignments within their defined scopes.
- Instance administration provides deep-linkable dashboards and tenant, user, authentication, SMTP, ingredient, and unit management.
- Middleware protects administration and tenant-management routes, preserves validated post-login navigation, and the web client validates restored sessions with the API.
- A sticky global head bar provides localized sign-in, authenticated-user, authorized administration, and sign-out actions on every web route, including invitation acceptance routes.
- Instance-administration UI code is organized under `apps/web/src/features/admin`.
- Tenant owners can create service accounts, assign existing tenant roles, issue one-time-view opaque bearer tokens, inspect token lifecycle metadata, revoke tokens, and disable service accounts.
- Bearer-token authentication resolves service accounts through their active tenant membership and permissions; recipe and recipe-draft APIs therefore support AI and automation clients without a separate agent API.
- Private recipes, category subtrees, and complete cookbooks can be shared with an AI through one-time 30-minute context links. Exchanging a link returns a scoped read-only bearer token valid for 4, 8, or 24 hours and a machine-readable reader endpoint manifest.
- AI context reader endpoints expose published recipes, immutable published and archived recipe revisions, current drafts, and categories within the selected scope. They do not expose management resources or write operations.
- The cookbook recipe page and selected-category recipe-grid header provide localized AI-context share actions. The modal duration selector displays and copies the one-time context URL.
- AI context manifests provide tenant identity, public web origin, and cookbook, category, recipe, and variant URL templates for AI-generated deep links.
