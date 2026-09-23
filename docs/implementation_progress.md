# Shadowcook 2.0 implementation progress

## Completed

- Tenant administration supports renaming and permanently deleting tenants. Disabled tenants are excluded from selection and cookbook access.
- Tenant-scoped cookbook headings and breadcrumbs use the selected tenant display name.

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
- Instance authentication settings and tenant creation administration views.

- Instance SMTP configuration API with encrypted password storage, permission-gated access, and test-message delivery.
- Deep-linkable `/admin/settings` interface for SMTP configuration and test-message delivery.
- Dedicated deep-linkable instance administration area with dashboard, tenant, user, settings, and SMTP settings navigation.

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
- Deferred database constraint that requires every recipe revision to have a category.
- Development-only command for recreating the disposable PostgreSQL schema.
- Collapsible cookbook category tree with localized accessible expand and collapse controls.
- Persisted category sibling ordering in the database, API, development seed, and cookbook tree.
- Accessible recipe detail endpoint with ordered preparation steps and step-specific ingredient usages.
- Clickable cookbook recipe cards with a localized recipe detail view.
- Deep-linkable cookbook navigation with hierarchical category and recipe-slug URLs.
- Tenant-unique category slugs in the initial database schema.
- Astro SSR and same-origin `/api` forwarding for directly reachable cookbook deep links.
- Root-level category and recipe URL paths with database-enforced reserved slugs.
- Accessible breadcrumb navigation for the cookbook, category hierarchy, and recipe detail views.
- Canonical root cookbook recipe URLs without a category segment.
- Direct and in-application sign-in routing at `/login`.
