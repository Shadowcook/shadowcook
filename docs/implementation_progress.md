# Shadowcook 2.0 implementation progress

## Version 2.5 planned scope

- Media upload, storage, rendering, and lifecycle management.
- Pantry ingredient matching, portion scaling, timers, cooking mode, favorites, and AI-assisted cooking sessions.
- Tenant federation sharing policy, recipe import and upstream synchronization, and subscriptions.
- Portable tenant backup, restore, and migration.
- Background workers for synchronization, backup reminders, and maintenance.

## Completed

- Recipe editing has Recipe, Steps, and Variants tabs. Draft saving and publishing actions are available on every existing-recipe tab. The Variants tab provides a table for names, URL slugs, default selection, visibility, and icon actions; add and edit actions use dialogs with immediate recipe-local slug collision feedback. Variant mutations update the recipe draft state locally so they enable publishing without resetting the editor scroll position. Only visible variants may be selected as the default.

- The recipe reader shows a variant selector only when a visible non-default variant is available.

- Tenant-management subpages use one shared Back to cookbook control above their content frame.

- Recipe-step amounts omit insignificant trailing decimal zeroes in the editor.

- Recipe variants now have permission-gated draft APIs for listing, creating, editing, deleting, and replacing direct step memberships. Published recipe reads resolve the default variant or an explicitly requested variant slug.
- Recipe creation and the development seed create a default variant. Draft creation copies stable step and variant keys and direct step memberships.

- Tenant user invitations require an email address and exactly one selected tenant role; acceptance creates the account and its tenant membership.
- Tenant-Managers can access every tenant, create, edit, disable, and delete tenants, and manage tenant-user role assignments for every tenant. Only instance administrators can assign instance-wide roles.
- Instance administrators can assign and remove instance roles for users from the deep-linkable user management view.
- Tenant managers can open `/{tenant-slug}/manage/users` and assign tenant roles only to existing users of that tenant. Tenant role APIs enforce the tenant scope for user lookup and role IDs.
- New tenants receive `Owner`, `Editor`, and `Viewer` tenant roles. The development seed includes the local owner and a local viewer membership.
- Instance administration provides a deep-linkable user list with display-name rename, activation control, email-delivered password reset, and soft-delete actions. Soft-deleted accounts retain historical records while their email addresses are reusable by new accounts.
- Instance administration can invite users by email. Invitation acceptance creates the account with a user-selected display name and password, then redirects to login; password entry is omitted for email-code-only instances.
- Password-reset links are single-use and expire after one hour. Administrator requests revoke sessions and require the reset; self-service requests do not force a password change before their reset link is completed.
- Astro middleware redirects unauthenticated administration and tenant-management requests to login while preserving the requested internal path for post-login navigation. Authenticated users without the needed tenant-management permission receive an access-denied page.
- The deep-linkable `/{tenant-slug}/manage` route opens the cookbook-management workspace with a placeholder until a management area is selected.

- Recipe step entries support either a validated catalogue ingredient or an explicit free-text override; the database enforces exactly one representation per entry.

- Recipe step editing presents each step's instruction and ingredient list side by side on desktop viewports, with a responsive stacked mobile layout.

- Astro middleware validates browser sessions before serving tenant recipe-management routes and returns 401 for missing or invalid tokens.

- Recipe drafts support creation, editing, deletion, and persisted up/down ordering of preparation steps and their normalized ingredient usages.

- Recipe category assignment uses an expandable hierarchy while retaining independent category checkboxes.

- The permission-aware tenant navigation is confined to the cookbook management workspace, which provides recipe management, draft list, category management, and recipe creation.

- Tenant recipe editor creates and saves mutable drafts, turns changes to published recipes into new drafts, and publishes category-assigned drafts as incrementing immutable versions.
- Recipe visibility supports private and public publication; published recipes can receive opaque tokenized share links.
- Deep-linkable editor routes support recipe creation, editing, and a dedicated tenant draft list.

- Tenant-scoped, deep-linkable category management creates, renames, reparents, and deletes unused category trees. Category operations require the tenant `category:update` permission.
- Category deletion is prevented for categories and subtrees used by recipe revisions.
- Category delete controls are disabled when the category or any of its descendants is used by a recipe revision.
- The category editor suggests a URL name from a new category name and validates its format, reserved route names, and tenant-local conflicts while editing.
- The category editor provides accessible up and down controls for sibling ordering.
- The JSON development seed defines `user@local` / `user` as the local cookbook Owner and `guest@local` / `guest` as the local cookbook Viewer without instance management roles.

- Cookbook client responsibilities are split into dedicated screen, dashboard, category tree, public tenant-selection, tenant-management, sign-in, password-change, status-message, and API-client modules.
- The web client validates every restored browser session against the API; invalid server-side sessions clear the per-tab presentation cache immediately.
- Administration navigation uses History API transitions, retaining the active administration island between internal page changes.
- Project source, styles, contracts, and documentation use the shared Prettier formatting configuration.
- Tenant administration supports renaming and permanently deleting tenants. Disabled tenants are excluded from selection and cookbook access.
- Tenant-scoped cookbook headings and breadcrumbs use the selected tenant display name.
- Tenant creation closes its management dialog and shows a transient success toast after the tenant list refreshes.

- Stepwise sign-in form with an email-first code flow, six individual code inputs, and password fallback.
- Tenant creation generates an editable slug from the cookbook name and validates the slug server-side.
- Tenant creation rolls back when invitation-code creation or SMTP delivery fails; development records are loaded generically from the local `development-seed.json` file.
- Development cookbook categories, recipes, revisions, steps, ingredients, units, and ingredient usages are defined in the JSON seed rather than TypeScript seed logic.
- Public cookbook category responses include category ancestors for complete deep-linkable trees.
- Cookbook tenant selection prevents recipes and categories from different tenants from being shown together.
- The root web route renders tenant-selection cards and links to tenant-scoped cookbook routes; `/admin/tenants` provides the filterable tenant administration table and creation dialog.
- Tenant selection uses cookbook cards with optional descriptions and published recipe counts.
- Tenant administration uses fixed-width table columns with single-line truncated descriptions and compact icon actions.

- Configurable instance authentication policy with password and email-code login modes.
- Hashed, expiring, rate-limited email one-time codes and SMTP-delivered login codes.
- Tenant creation with tenant-manager authorization, owner role, audit event, and email-verified invitation acceptance.
- Tenant invitations explain active-session email mismatches and allow sign-out before accepting the invitation.
- One-time-code inputs clear their state on account and session changes and disable browser autocomplete.
- The six-field login-code input supports digit distribution on paste and backward deletion across fields.
- Instance authentication settings and tenant creation administration views.

- Instance SMTP configuration API with encrypted password storage, permission-gated access, and test-message delivery.
- Deep-linkable `/admin/settings` interface for SMTP configuration and test-message delivery.
- Dedicated deep-linkable instance administration area with dashboard, tenant, user, settings, and SMTP settings navigation.
- Instance administration provides deep-linkable UOM management with server-owned unit CRUD, recipe-usage deletion protection, and same-dimension conversion checks.
- Administration pages use the available desktop viewport width; recipe detail layout stacks its ingredient and preparation columns on narrow screens.
- A one-time initial-deployment seed populates common instance-owned recipe units for mass, volume, count, and temperature before bootstrap administration and development seeding.
- Seeded standard units provide stable localization keys; the web client localizes their names and symbols in the unit administration and recipe detail interfaces while administrator-defined units retain their stored presentation.
- Instance administration provides deep-linkable ingredient and alias management. The initial deployment seed contains localized standard ingredients and aliases, and recipe details localize referenced standard ingredients.

- pnpm workspace baseline with API and database packages.
- PostgreSQL initial schema migration for tenants, identities, principals, authorization, catalogues, recipes, immutable revisions, revision content, media, audit events, cooking sessions, sharing, federation upstreams, and federation mappings.
- In-process startup migration runner with PostgreSQL advisory locking, transaction-per-migration execution, checksums, and migration history.
- Fastify API startup sequence that runs migrations before opening its HTTP listener.
- `GET /health` endpoint and OpenAPI contract.
- Instance-wide and tenant-scoped role structure with canonical permissions and a seeded instance administrator role.
- Human password login, opaque HttpOnly browser sessions, and forced password-change state.
- Startup bootstrap administrator with a one-time generated password logged by the API process.
- CLI maintenance command for password resets: `NEW_PASSWORD='...' pnpm maintenance reset-password <email>`.
- Development bootstrap account `admin@local` / `admin` without forced password change when `NODE_ENV=development`.
- Astro web application with a React login island, password change, session restoration, logout, and an empty cookbook dashboard.
- `pnpm dev:api` starts the API with `NODE_ENV=development`.
- Web application locale dictionary with English default, German translation, locale-configured metadata, accessible labels, and localized API error codes.
- Vector Shadowcook logo with a penguin holding a cooking spoon and spatula.
- Authenticated cookbook overview endpoint returning tenant categories and published recipes.
- Cookbook dashboard with category filtering and recipe cards.
- Idempotent development seed for the local cookbook tenant, administrator membership, categories, and published recipes.
- Initial-schema root-level category slug uniqueness.
- Public read-only cookbook overview without an automatic login gate; authenticated users additionally receive their tenant recipes.
- Initial-schema public recipe visibility default.
- Development category tree with seed data through five levels and recipes assigned to multiple categories.
- Deferred database constraint that requires every published recipe revision to have a category while allowing uncategorized drafts.
- Development-only command for recreating the disposable PostgreSQL schema.
- Collapsible cookbook category tree with localized accessible expand and collapse controls.
- Persisted category sibling ordering in the database, API, development seed, and cookbook tree.
- Accessible recipe detail endpoint with ordered preparation steps and step-specific ingredient usages.
- Recipe step entries support validated ingredient references, plain text overrides, and icon-marked semantic entries for remove, add, information, important, cook, cool, heat, wait, and work-step instructions.
- Recipe ingredient selection uses a delayed, server-backed catalogue search and keeps special entries available without loading the ingredient catalogue.
- Recipe step entries use one shared note input for ingredient notes, free text, and special-entry descriptions.
- Recipe step rows retain editable amount, unit, ingredient, note, and optional controls for every selection; the API discards amount, unit, ingredient note, and optional values for special entries.
- Recipe detail rows render free-text and special-entry descriptions in the ingredient position, with special-entry icons immediately preceding their descriptions.
- Recipe detail rows emphasize normalized ingredient names and render their notes in italic secondary text.
- Recipe detail views provide a selected-variant shopping list with aggregated ingredient quantities.
- Recipe detail variant selection aligns with the start of the preparation steps beside the shopping list.
- Development seed includes the multi-variant Grand harvest lasagna recipe with all supported special ingredient-entry kinds.
- Clickable cookbook recipe cards with a localized recipe detail view.
- Recipe detail views display localized, accessible edit and share-link pictogram actions when the current session has the corresponding recipe capability.
- Deep-linkable cookbook navigation with hierarchical category and recipe-slug URLs.
- Tenant-unique category slugs in the initial database schema.
- Astro SSR and same-origin `/api` forwarding for directly reachable cookbook deep links.
- Root-level category and recipe URL paths with database-enforced reserved slugs.
- Accessible breadcrumb navigation for the cookbook, category hierarchy, and recipe detail views.
- Canonical root cookbook recipe URLs without a category segment.
- Direct and in-application sign-in routing at `/login`.
- Tenant-owned ingredient CRUD and alias administration at deep-linkable tenant management routes.
- Recipe-editor ingredient search covers aliases, marks exact matches, and provides an on-the-fly tenant ingredient dialog with optional aliases.
- Tenant administration provides deep-linkable CRUD management for tenant-owned units of measure.
