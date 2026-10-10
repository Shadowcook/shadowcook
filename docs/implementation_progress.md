# Shadowcook 2.0 implementation progress

## Completed architecture features

### Platform, persistence, and development data

- The pnpm workspace contains the Fastify API, Astro web application, database package, and OpenAPI contract.
- The Docker Compose deployment package includes an upgrade script that resolves a requested Git ref to a full commit before rebuilding the API and web runtime images, removes unused labelled Shadowcook deployment images after a successful recreation, embeds the root package version and the commit prefix in the localized web footer, supports bundled or existing PostgreSQL through separate Compose configurations, includes an Apache reverse-proxy example, and can be created as a versioned server-copyable tarball.
- PostgreSQL uses the initial normalized schema for tenants, principals, roles, catalogues, recipes, immutable revisions, media, audit events, cooking sessions, sharing, federation upstreams, and mappings. The initial schema migration is maintained as a UTC timestamp-prefixed SQL file.
- API startup runs transactional, advisory-lock-protected migrations with recorded checksums and UTC timestamps before binding its HTTP listener. The database package discovers all SQL-only migration assets in lexicographic filename order.
- The automated-test foundation provides a sequential root test runner with per-suite and overall pass/fail summaries, deterministic clock/token helpers, Fastify API factory helpers, and isolated PostgreSQL integration fixtures. API, contract, and migration suites run against a fresh disposable Docker PostgreSQL container on a random loopback port; unit tests cover password, token, cookie, email-normalization, and encryption functions.
- Priority-0 API integration coverage verifies login failures, HttpOnly session lifecycle, logout revocation, disabled and expired session rejection, password-change-required restrictions, and tenant-role separation from instance administration.
- Priority-0 API integration coverage verifies that a tenant category manager can read and mutate only its own tenant categories and cannot use another tenant's slug or category public ID to read or mutate data.
- The API exposes the health endpoint and documented API contract.
- Development startup loads the base JSON seed and then an optional local JSON content seed for ingredients, categories, recipes, revisions, variants, steps, ingredient usages, and their referenced catalogues.
- The tracked initial-deployment seed creates localized instance-owned units.
- `pnpm reset:shadowcook-db` and its `pnpm reset:dev-db` alias recreate only the `public` schema of the development `shadowcook` database.
- The separate local `apps/migration` workspace application provides `pnpm migrate:production-cookbook`, uses isolated `SOURCE_DB_*` and `TARGET_DB_*` settings from `.env.migration`, and performs a read-only HSQLDB-to-PostgreSQL legacy cookbook migration with required target-tenant selection, Owner author attribution, a transactional dry run, deterministic category and recipe slugs, published revisions, default variants, ordered steps, tenant ingredients created from real-unit usages, authored usage notes from parenthetical text and comma-separated modifiers, semantic special entries, and legacy unit mapping.
- `pnpm export:development-content-seed` validates the selected development tenant for a JSON category and recipe content export; its `--execute` mode writes the optional local development content seed.
- Development ingredient cleanup exports all catalogued content-seed ingredients to a four-column CSV and ingests validated renames, recipe-note modifiers, and aliases back into the content seed.

### Cookbook, public web, and localization

- The Astro application provides server-rendered, deep-linkable tenant selection, category, recipe, variant, sign-in, and administration routes, with same-origin API forwarding.
- Cookbook overview and recipe-detail APIs provide tenant-scoped published content, category trees, ordered steps, ingredient usages, reader capabilities, and variant resolution.
- New and imported recipes are featured by default.
- Public cookbook access supports public recipes; authenticated users additionally receive accessible tenant recipes.
- Tenant General settings configure the front-page featured-recipe count, recipe defaults, an optional front-page heading with an 80-character limit, and an optional cookbook description with a 280-character limit.
- Instance Front page settings configure the root-page website name, slogan, and cookbook page size. Tenant General settings configure whether the cookbook is shown on the root page. The root page lists only accessible, enabled, opted-in cookbooks, filters them by a contains match, and presents stable shuffled pagination.
- The root page presents an authenticated user's enabled cookbook memberships in a localized `My Cookbooks` section above the filtered public cookbook selection, independent of root-page and recipe visibility settings.
- The localized footer links the license and application version to the GitHub build commit, and links to deep-linkable public privacy-statement and legal-notice pages. New initial databases contain editable English Markdown templates with operator placeholders; instance administrators maintain the two public documents in Legal documents settings.
- Category and recipe slugs are tenant-unique, route segments are reserved in the database, and cookbook navigation supports root recipe URLs, category paths, and breadcrumbs.
- Hydrated cookbook categories, recipes, breadcrumbs, and tenant-management navigation are native deep-link anchors that support opening in a new browser tab.
- Hydrated category navigation updates the selected cookbook category without remounting the category tree, retaining manually expanded branches.
- Mobile cookbook navigation provides the category tree in a header-adjacent left-side drawer with a fixed close control and a scrollable category list.
- Category management supports hierarchical creation, renaming, reparenting, guarded deletion, and adjacent sibling ordering.
- The web client uses localized English and German UI dictionaries for UI text, metadata, accessibility labels, and API errors; authored recipe text remains unchanged.
- Web UI pictograms are bundled from the Font Awesome core, solid-icon, and React packages.
- Cookbook code is organized under `apps/web/src/features/cookbook`; shared browser-session and API infrastructure is under `apps/web/src/lib`.
- Direct recipe URLs render semantic recipe content on the Astro server without requiring JavaScript and include canonical Schema.org Recipe JSON-LD with author, categories, ingredients, and ordered steps.
- Public cookbook overview and category URLs render accessible category and recipe links on the Astro server without waiting for a browser session check.
- Public cookbook overview, category, and recipe pages server-render and hydrate the same cookbook component with server-resolved data.
- Server-rendered recipe pages render the resolved `CookbookScreen`; JavaScript-capable browsers hydrate the same component and non-JavaScript clients retain its semantic HTML recipe page.

### Recipe authoring, revisions, and variants

- Recipe-step editors append steps and insert new steps immediately after any existing step.
- Recipe-step instruction line breaks and other authored whitespace are retained when drafts are saved and rendered in recipe details.
- Recipes use mutable drafts and immutable published revisions, with category assignment, publication, incrementing versions, and draft lists on deep-linkable tenant management routes. Recipe slug, featured state, visibility, and discoverability are immediate recipe-level metadata and do not create drafts or revisions.
- Recipe editors provide a revision history tab for published and archived snapshots, including metadata, categories, steps, ingredient usages, variants, and changes against the preceding published revision. Historical revisions are read-only and cannot yet be restored.
- Recipe steps contain normalized ingredient usages, free-text ingredient overrides with independent notes, optional values, and semantic special-entry kinds with optional notes.
- Recipe-step instructions support UUID-based recipe links. The editor provides an `@` picker with a delayed current-tenant recipe search, and recipe details render resolved references as links.
- Ingredient preparation and state information is stored as authored free-text usage notes. It is preserved without translation or mapping during federation.
- Ingredient search is delayed and server-backed, searches aliases, and supports creating tenant ingredients during editing.
- Published recipe details render step-oriented ingredients and preparation, special-entry icons, normalized ingredient notes, and aggregated shopping lists.
- Recipe variants have stable keys, direct step membership, one visible default variant, draft APIs, and reader resolution by optional variant slug.
- Recipe creation, draft creation, and the development seed create and preserve default variants, stable step keys, variant keys, and direct step memberships.
- Recipe visibility and discoverability use tenant defaults with inheritable recipe overrides. `PRIVATE`, `MEMBERS_ONLY`, and `PUBLIC` visibility are enforced for recipe reads; `DISCOVERABLE` and `UNLISTED` control cookbook lists while direct links remain access-controlled. Opaque share links grant access to the full published default variant, can have an optional name and UTC expiry, and are listed, copied, and individually revoked from the recipe editor; those actions require the `recipe:visibility-update` permission.
- Recipe editors manage a featured flag. Cookbook root pages show only eligible featured recipes in session-seeded pagination, with a tenant-configured front-page recipe count.
- The localized `Featured` root navigation renders featured recipes until a non-empty recipe search switches the root list to all accessible discoverable matching recipes, regardless of featured state.
- Cookbook category recipe lists paginate at 100 recipes and recipe-link searches normalize Unicode accents and transliterations to ASCII, treat non-alphanumeric ASCII characters as word separators, and rank exact normalized title matches, title phrase matches, title token matches, summary phrase matches, and summary token matches in that order.
- Tenant recipe management lists paginate published recipes at 100 results, use normalized recipe search, and use alphabetical title ordering within each match-rank group.

### Catalogues and units

- Instance administration manages instance-owned units with same-dimension conversion validation and usage-aware deletion protection.
- Units of measure support non-convertible cookbook units and human-readable one-unit equivalences to visible non-temperature units.
- Tenant Owner roles receive all tenant-scoped permissions, including permissions added before the migration.
- Standard units use localization keys; tenant ingredients and aliases retain their stored presentation.
- Tenant management provides deep-linkable ingredient, alias, and unit CRUD.
- Tenant ingredient management provides one action dialog for transactional merging, alias conversion, alias separation into independent ingredients for exact alias usages, and conversion of catalogue ingredients into free-text recipe entries with recipe-usage reassignment. Merges require a source-and-target confirmation that states their irreversible effect. Ingredient-management API failures open a localized error dialog with a response-code-specific message.
- Recipe ingredient usages retain the selected alias for recipe output while sharing the normalized ingredient identity for search and aggregation.

### Authentication, authorization, and administration

- Human password authentication, email-code authentication, opaque HttpOnly sessions, password-change enforcement, password resets, and bootstrap administration are implemented. Instance administrators configure a 1-to-256-bit minimum estimated password entropy, with a local threshold-centred progress test; the default is 60 bits. The zxcvbn-ts estimate recognizes common words, sequences, repetitions, l33t substitutions, and keyboard patterns, while fully random character sequences use character-pool entropy. Browser indicator calculations are debounced by 200 milliseconds and analyze at most the first 64 characters. Registration, password-change, password-reset, and account-invitation forms show the same local threshold-centred progress indicator. All password-entry fields provide a localized show-or-hide control, and password-change completion does not require repeated entry. Entropy validation applies outside development only.
- Tenant invitation acceptance starts an invited account session, directs it to the assigned cookbook, and supports first-password completion without a current-password field and with localized repeated-password validation. Tenant-user invitations support invited existing accounts through an authenticated email-match check and add their existing principal to the selected cookbook membership.
- One-time email codes are hashed, expiring, rate-limited, and delivered through configured SMTP.
- SMTP configuration is permission-gated, encrypts stored passwords, and supports test delivery.
- Tenant creation is disabled until SMTP delivery is configured, with a localized configuration requirement, server-side `SMTP_REQUIRED` enforcement, and a localized mail-delivery failure message for owner invitations.
- The authorization model includes canonical permissions, instance roles, tenant roles, tenant memberships, tenant-scoped role assignment, and the initial `Owner`, `Editor`, and `Viewer` roles.
- Instance administration lists every website user and manages global instance roles, user deactivation, password resets, and soft deletion. Tenant membership and tenant-role assignment require the tenant-scoped `tenant:manage` permission.
- Instance administration provides deep-linkable dashboards and tenant, user, authentication, SMTP, and unit management.
- Middleware protects administration and tenant-management routes, preserves validated post-login navigation, and the web client validates restored sessions with the API.
- Protected tenant-management and instance-administration pages server-resolve their access state before rendering without a session-check loading screen.
- A sticky global head bar is server-seeded with the current session on every web route, then client-validated, and provides localized sign-in, authenticated-user, authorized administration, and sign-out actions, including invitation acceptance routes.
- Instance-administration UI code is organized under `apps/web/src/features/admin`.
- Tenant owners can create service accounts, assign existing tenant roles, issue one-time-view opaque bearer tokens, inspect token lifecycle metadata, revoke tokens, and disable service accounts.
- Bearer-token authentication resolves service accounts through their active tenant membership and permissions; recipe and recipe-draft APIs therefore support AI and automation clients without a separate agent API.
- Private recipes, category subtrees, and complete cookbooks can be shared with an AI through one-time 30-minute context links. Exchanging a link returns a scoped read-only bearer token valid for 4, 8, or 24 hours and a machine-readable reader endpoint manifest.
- AI context reader endpoints expose published recipes, immutable published and archived recipe revisions, current drafts, and categories within the selected scope. They do not expose management resources or write operations.
- The cookbook recipe page and selected-category recipe-grid header provide localized, AI-marked context-share actions. The modal duration selector displays and copies the one-time context URL.
- AI context manifests provide tenant identity, public web origin, and cookbook, category, recipe, and variant URL templates for AI-generated deep links.
- Public self-service registration creates an expiring pending registration only after backend honeypot and IP rate-limit validation, plus Turnstile validation when enabled by an instance administrator. Email verification atomically creates the user and owner tenant. Verification tokens and pending password hashes are stored only as hashes. Registration, optional Turnstile, and resend controls are configurable, resend responses are generic, and periodic cleanup removes expired pending registrations.
- Public self-service registration uses the normalized cookbook name as the tenant slug when available and appends a random suffix only after a slug collision. Instance administrators can update tenant display names and slugs; tenant owners cannot.
- Instance administrators can customize each system email’s subject and plain-text body through deep-linkable Email templates settings. The API validates type-specific placeholders, renders them server-side, and supports restoring built-in defaults. Templates provide recipient-name personalization from the account display name with recipient-email fallback. Cookbook invitations provide inviter, cookbook, invitation-link, and code fields where applicable.
