# Shadowcook 2.0 Architecture

**Status:** Draft architecture baseline  
**Target:** Shadowcook 2.0  
**Last updated:** 2026-09-23

---

## 1. Purpose

Shadowcook 2.0 is a redesign of Shadowcook as a modern, federated, multi-tenant cookbook platform.

The project remains centered around Shadowcook's defining UX principle: recipes are not rendered as a traditional ingredients list followed by preparation instructions. Ingredients and preparation steps are associated directly and displayed side-by-side, so the cook can see what is needed for a step and what must be done with it at the same time.

Version 2.0 expands that idea into a broader architecture with:

- human-readable, crawlable public recipe pages,
- normalized ingredient data,
- recipe variants with direct step membership,
- immutable published recipe history,
- tenant-owned sharing policies,
- AI- and automation-friendly editing APIs,
- cross-tenant and cross-instance recipe sharing,
- recipe subscriptions and synchronization,
- cryptographic tenant identities,
- portable full backups and tenant migration.

The architecture should work equally well for:

- a single-user self-hosted Shadowcook installation,
- a family or small community server,
- a hosted public Shadowcook service with many tenants,
- multiple independent Shadowcook servers exchanging recipes with each other.

---

## 2. Product principles

The following principles are architectural constraints, not just UI preferences.

### 2.1 Your cookbook belongs to you

A tenant owns its cookbook data and its sharing policy.

Hosting infrastructure must never imply ownership of cookbook content.

### 2.2 Privacy is the tenant's choice

A tenant may keep everything private, share individual recipes, share with explicitly trusted tenants, or publish recipes publicly.

Shadowcook encourages sharing but does not force publication.

### 2.3 Recipes are for sharing

Shadowcook should make recipe sharing simple and natural.

The application must not provide an instance-admin switch that globally disables tenant recipe sharing or federation for otherwise valid tenants.

A server administrator can always technically shut down or alter a server, but upstream Shadowcook should not model sharing as an administrator-granted privilege.

### 2.4 Hosting should never become ownership

A tenant must be able to export a complete portable backup and restore or move it to another Shadowcook instance.

### 2.5 You can always take your cookbook with you

Portable backup and restore are core V2.0 features.

A backup must include recipe history and must be usable on a different Shadowcook deployment.

### 2.6 Public recipe content is HTML-first

Recipes must not be hidden behind a client-side JavaScript application.

Public recipe content must be present in server-rendered or statically generated semantic HTML so that browsers, search engines, crawlers, and AI agents can read it without executing JavaScript.

JavaScript enhances the recipe experience but must not be required to read a recipe.

---

## 3. Proposed technology stack

### 3.1 Runtime and language

- Node.js LTS
- TypeScript
- pnpm workspaces / monorepo

### 3.2 Public web application

- Astro
- React islands for interactive features
- Vanilla CSS
- CSS Modules for components where possible
- Local/offline Font Awesome icons

Astro is responsible for producing crawlable HTML. React is used only where interaction materially benefits from client-side behavior.

Examples of React islands:

- portion scaling,
- timers,
- cooking mode,
- live ingredient interaction,
- favorite buttons,
- rich editor components,
- autocomplete.

### 3.3 API

- Fastify
- TypeBox / JSON Schema
- OpenAPI generated from API schemas

The same API contract should serve:

- the administration UI,
- Android clients,
- service accounts,
- AI agents,
- automation tools.

No separate "agent API" should be implemented unless there is a compelling transport-specific need.

### 3.4 Web application language

- English is the default web application language.
- UI strings, metadata, accessibility labels, and client-side API error messages are resolved through the web application's locale dictionary.
- `PUBLIC_DEFAULT_LOCALE` selects the Astro web build locale. Supported initial locales are `en` and `de`.
- Recipe text remains authored content and is not translated by the UI locale system.

### 3.4 Persistence

- PostgreSQL 15 or later
- Kysely as the primary SQL query builder

The design should prefer explicit SQL semantics over a heavyweight ORM abstraction.

### 3.5 Media

Recipe images and other large binary assets must not be stored as repeated blobs inside recipe revisions.

Media should live in filesystem/object storage and be referenced by stable media records.

The storage abstraction must allow a small self-hosted installation to use local storage while larger deployments can use object storage and a CDN.

---

## 4. Repository shape

Suggested monorepo layout:

```text
shadowcook/
├── apps/
│   ├── api/
│   │   └── Fastify
│   └── web/
│       └── Astro + React
│
├── packages/
│   ├── contracts/
│   │   ├── recipe/
│   │   ├── tenant/
│   │   ├── federation/
│   │   └── common/
│   ├── domain/
│   │   ├── recipe/
│   │   ├── tenant/
│   │   ├── sharing/
│   │   └── federation/
│   └── db/
│       ├── migrations/
│       ├── repositories/
│       └── generated-types/
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

### 4.1 Database migration execution

- The API process executes database migrations before binding its HTTP listener.
- Database migrations run in the API process and do not require a dedicated migration container.
- Migration execution uses a PostgreSQL advisory lock named `shadowcook-schema-migration`.
- Each migration is executed in one database transaction.
- Applied migration identifiers, SHA-256 checksums, and UTC application timestamps are stored in `application_schema_migration`.
- A migration checksum mismatch or an unknown applied migration stops API startup.
- The API process loads the optional repository-root `.env` file only as a local-development convenience. Existing process environment variables remain authoritative.

### 4.2 Cookbook overview

- `GET /cookbook` returns publicly visible published recipes without authentication and all published recipes for tenants in which the authenticated user's principal is a member.
- The cookbook overview exposes category and recipe public identifiers, slugs, titles, summaries, category assignments, and category parent public identifiers.
- The API process seeds the `local-cookbook` tenant, four categories, and three published recipes only when `NODE_ENV=development`.
- The development seed defines `user@local` with password `user` and assigns it the `Owner` tenant role for `local-cookbook` without an instance role.
- The development seed defines `guest@local` with password `guest` as a `Viewer` member of `local-cookbook` without instance role assignments.
- The API process runs the tracked `initial-deployment-units-v1` seed once for each database after migrations and before bootstrap administration. The seed inserts instance-owned recipe units from `initial-deployment-seed.json` and records its identifier in `application_seed` in the same transaction.
- Tenant recipe visibility defaults to `PUBLIC`; recipes can inherit or override tenant visibility and discoverability defaults.
- Categories support parent-child trees with no fixed database depth limit.
- A category slug is unique within its tenant. A recipe slug is unique within its tenant.
- Cookbook navigation is deep-linkable: category pages use `/{category-slug}/{sub-category-slug...}` and recipe pages use `/{category-slug}/{sub-category-slug...}/recipes/{recipe-slug}`. A non-default visible variant appends `/{variant-slug}`. A recipe opened from the root cookbook view uses `/recipes/{recipe-slug}`; a recipe opened from a category view uses that category path.
- The category and recipe slug reservation list is `admin`, `api`, `assets`, `auth`, `health`, `login`, `logout`, `recipes`, and `settings`. The database rejects these values for both entity types.
- `/login` is the public sign-in route. An unauthenticated request to it renders the sign-in form; an authenticated request redirects to `/`.
- `/` presents the accessible tenant selection. Cookbook content is loaded only after choosing a tenant at `/tenants/{tenant-slug}`; a cookbook response contains records from exactly one tenant.
- Successful sign-in and sign-out navigate to `/` as full page transitions so the tenant-selection route, rather than a previously mounted cookbook client, controls the root page.
- A tenant has an optional description. The tenant-selection response includes the number of published recipes for each accessible tenant.
- The Astro web application uses server rendering so category and recipe navigation paths are directly addressable. It proxies browser API requests with the `/api` prefix to `SHADOWCOOK_API_ORIGIN`, which defaults to `http://localhost:3000`.
- Public cookbook overview and category navigation paths render their accessible category and recipe links as semantic server-rendered HTML without a client-side session check.
- Public cookbook overview and category pages retain their server-rendered HTML in the response and replace it with the hydrated cookbook client only after the client has loaded its session and cookbook state.
- A direct recipe navigation renders its title, summary, category links, selected visible variant links, ingredient usages, and preparation steps as semantic server-rendered HTML. The server forwards the request cookie when resolving recipe access.
- Server-rendered recipe pages render their aggregated shopping list and variant links in HTML; browser JavaScript enhances variant links with a URL-selecting control without removing the HTML navigation from the response.
- Server-rendered recipe pages include a canonical URL and a Schema.org `Recipe` JSON-LD document with the recipe URL, tenant author, title, optional summary, category names, non-special ingredient usages, and ordered preparation steps.
- Sibling categories have a non-negative tenant-scoped `sort_order` that is unique within their parent category.
- Every published recipe revision has at least one category. Draft revisions may be uncategorized.
- The tenant-scoped category editor is available at `/{tenant-slug}/categories`. It requires `category:update` and creates, updates, reparents, and deletes categories through `/cookbook/tenants/{tenantSlug}/categories`.
- `/{tenant-slug}/manage` is the deep-linkable cookbook-management entry route. It displays the tenant management navigation and an empty management-area placeholder until a concrete management route is selected.
- The category editor changes a category's sibling order only by moving it one position up or down. The operation swaps `sort_order` with the adjacent category under the same parent.
- A category deletion is rejected when the category or any of its descendants is assigned to a recipe revision. Category slugs reserve `categories` in addition to the other cookbook route segments.
- Editable category responses expose whether a category tree can be deleted, based on recipe-revision assignments in that category and all descendants.
- A future draft view will list recipes with an active draft revision separately from published cookbook navigation.
- `GET /cookbook/recipes/{publicId}` returns one accessible published recipe with ordered preparation steps and the ingredient usages assigned to each step.
- The web client separates cookbook orchestration, cookbook dashboard rendering, category tree rendering, public tenant selection, tenant management, sign-in, password change, status messages, and browser API requests into dedicated components or modules.
- `apps/web/src/features/cookbook` contains cookbook orchestration, cookbook UI components, routing, and cookbook model types. `apps/web/src/features/admin` contains instance-administration orchestration and UI components. `apps/web/src/lib` contains shared browser-session and API-request infrastructure.

### 4.3 Development database reset

- `pnpm reset:shadowcook-db` drops and recreates the PostgreSQL `public` schema in the `shadowcook` database only when `NODE_ENV=development`.
- `pnpm reset:dev-db` remains an alias for the development database reset.
- The next API startup applies the current initial schema and development seed.
- The optional repository-root `development-seed.json` stores development database records as table-name keys and row arrays. The loader validates every table and column against the active PostgreSQL schema and inserts rows in JSON property order. Omitted columns use database defaults; relations use explicit stable identifiers. `$seedRef` resolves bootstrap seed values, `$encrypt` encrypts a string for a `bytea` column, and the development-only `$passwordHash` creates an scrypt password verifier. The local file is excluded from version control; `development-seed.example.json` is the template.
- The repository-root `initial-deployment-seed.json` is versioned deployment data. An initial-deployment seed is applied once and is not reapplied after an administrator changes or deletes seeded records.

### 4.4 Instance mail delivery

- SMTP settings are instance-wide and are available only to principals with `instance:mail-manage` or `instance:administer`.
- SMTP passwords are encrypted using AES-256-GCM with the base64-encoded 32-byte `INSTANCE_SECRET_KEY` supplied to the API process.
- The API does not return stored SMTP passwords.
- SMTP transport supports STARTTLS and implicit TLS and can send a test message through the stored configuration.

### 4.5 Docker-first runtime configuration

- A deployed Shadowcook instance runs as containers. The API process is configured through container environment variables and Docker Secrets.
- A repository-root `.env` file is only a local-development convenience and is not required by a container deployment.
- The operator-facing Docker Compose package is in `deployments/package`. Its `.env` selects the Git repository URL and Git ref used as the Docker build context.
- Docker Compose builds the database package, API, and Astro web application from the selected Git ref before creating the API and web runtime containers.
- The Dockerfile has one build stage and separate API and web runtime targets. The runtime targets contain compiled application output and production dependencies.
- `deployments/package/compose.yaml` starts API, web, and a persistent bundled PostgreSQL service. `deployments/package/compose.external-postgres.yaml` starts API and web only and requires `DATABASE_URL` for an existing PostgreSQL service.
- `pnpm package:deployment` creates a versioned tarball containing the Dockerfile, Apache reverse-proxy example, and operator-facing deployment package files.
- The API waits for the bundled PostgreSQL health check before startup. The web service waits for the API health check before startup.
- Secrets required before the API can access PostgreSQL data remain outside the database. `INSTANCE_SECRET_KEY` is supplied as a base64-encoded 32-byte value or as the path named by `INSTANCE_SECRET_KEY_FILE`.
- Docker deployments provide `INSTANCE_SECRET_KEY_FILE=/run/secrets/instance_secret_key` and mount the secret at that path.
- Database connection configuration and operational encryption keys are deployment configuration. SMTP server details, SMTP credentials, sender identity, and other settings an instance administrator can change at runtime are stored in the database and managed through the administration UI.
- Stored operational secrets are encrypted with the instance encryption key and are excluded from backups.

### 4.6 Instance administration

- `/admin` is a reserved, instance-wide web namespace and is not a tenant slug.
- Astro middleware redirects an unauthenticated request for a protected administration or tenant-management route to `/login?next=<requested-path>` before the page is served. After successful login, the web client returns to the validated internal `next` path.
- The instance administration UI has its own navigation and does not use cookbook breadcrumbs.
- `/admin` is the administration dashboard, `/admin/tenants` is tenant management, `/admin/users` is instance and tenant user management, `/admin/settings` is the instance settings overview, and `/admin/settings/smtp` manages SMTP delivery.
- `/admin/units` manages instance-owned units of measure and provides same-dimension conversion checks.
- Instance authentication uses `PASSWORD_ONLY`, `EMAIL_CODE_ONLY`, or `PASSWORD_OR_EMAIL_CODE`; the default is `PASSWORD_OR_EMAIL_CODE`.
- Email one-time codes are SHA-256 hashed, expire after ten minutes, allow five failed verifications, and are limited per email address and client IP.
- Tenant owners are assigned through a time-limited invitation, verified against the invited email address, and receive a tenant-scoped Owner role on acceptance.
- An active session may accept a tenant-owner invitation only when its email address matches the invited email address; the invitation page provides a sign-out action for a mismatched session.
- One-time email and invitation codes are cleared on session, account, and authentication-step changes and are excluded from browser autocomplete.
- The six-field login-code control distributes pasted digits from the active field and uses backspace in an empty field to remove and focus the preceding digit.
- `PUBLIC_WEB_ORIGIN` is the public web origin used to construct invitation URLs.
- Tenant creation commits only after SMTP delivery of the owner invitation succeeds.
- A disabled tenant is excluded from tenant selection, cookbook responses, recipe-detail responses, and invitation acceptance.
- Deleting a tenant permanently deletes its tenant-owned records and inbound sharing records that identify the deleted tenant by public ID.
- A cookbook response includes the selected tenant display name for the tenant-scoped page heading and breadcrumb.
- Successful tenant creation from the tenant-management dialog closes the dialog, refreshes the tenant list, and displays a transient success toast.

---

## 5. High-level topology

```text
                        INTERNET
                           │
                           ▼
                 ┌──────────────────┐
                 │   Astro Web      │
                 │                  │
                 │ SSR HTML         │
                 │ React Islands    │
                 │ JSON-LD          │
                 │ Sitemap          │
                 └────────┬─────────┘
                          │
                          │ internal/API access
                          ▼
                 ┌──────────────────┐
                 │   Fastify API    │
                 │                  │
                 │ REST             │
                 │ OpenAPI          │
                 │ AuthZ            │
                 │ Federation       │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │   PostgreSQL     │
                 └──────────────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ Media Storage    │
                 └──────────────────┘

                          ▲
                          │ REST/OpenAPI
                          │
                ┌────────────────────┐
                │ Android / Agents   │
                └────────────────────┘
```

Public read operations and authenticated/private operations are first-class API concepts.

---

## 6. Multi-tenancy

### 6.1 Instance vs tenant

An **instance** is a Shadowcook deployment.

A **tenant** is a cookbook identity.

An instance may host one or many tenants.

```text
Instance
├── Tenant Ursula
├── Tenant Petra
└── Tenant Thomas
```

Single-user self-hosting is simply a one-tenant instance.

### 6.2 Tenant is the content and security boundary

Recipes, sharing policies, subscriptions, service accounts, and cookbook-level settings belong to a tenant.

Tenant context should be explicit in repository and authorization code.

Repository calls should prefer patterns such as:

```ts
recipeRepository.findById(tenantId, recipeId);
```

instead of globally querying by recipe ID and applying tenant filtering later.

### 6.3 User and tenant are not the same concept

A human account may belong to one or more tenants.

A tenant may have multiple members.

```text
Principal
├── HumanUser
└── ServiceAccount

Tenant
└── TenantMembership *
    ├── Principal
    └── Role / Permissions
```

This allows:

- one person to manage multiple cookbooks,
- family cookbooks,
- collaborative cookbooks,
- AI service accounts scoped to a specific tenant.

### 6.4 PostgreSQL Row-Level Security

PostgreSQL Row-Level Security may be used as an additional guardrail for larger hosted installations.

Application-level authorization remains mandatory even if RLS is enabled.

---

## 7. Public URLs and crawlability

Public URLs should be human-readable.

Examples:

```text
/@ursula/recipes/american-cheesecake
/@ursula/recipes/sandwiches/parmesan
/@ursula/categories/backen/brot
```

Single-tenant instances or custom domains may expose shorter URLs such as:

```text
/recipes/american-cheesecake
```

Public slugs are locators and presentation identifiers, not primary identity keys.

Stable internal/public UUIDs remain authoritative.

### 7.1 Public recipe HTML

Recipe title, ingredient usages, preparation steps, category links, and relevant metadata must be rendered in the HTTP response.

JavaScript must not be required to discover recipe content.

### 7.2 Structured data

Public recipe pages expose Schema.org Recipe JSON-LD.

Shadowcook's step-oriented ingredient structure is converted into the flatter structures expected by external consumers only at render/export time.

The internal domain model remains Shadowcook-native.

---

## 8. Recipe domain model

### 8.1 Recipe

A recipe belongs to exactly one tenant.

A recipe has:

- a stable public identity,
- a stable `lineage_public_id` shared by all forks of the same recipe family,
- a human-readable slug,
- metadata,
- one or more variants,
- steps,
- ingredient usages,
- categories,
- published revisions,
- one mutable draft,
- an optional recipe-level visibility override,
- sharing/discovery policy overrides where needed,
- optional upstream/federation metadata.

### 8.2 Categories

Categories remain hierarchical.

A recipe may belong to multiple categories.

Recipes are edited through exactly one mutable draft revision. Creating a recipe creates its first draft. Editing a published recipe copies its published title, summary, and category assignments into a new draft; publishing archives the prior published revision, assigns the next version number, and clears the draft pointer. A published revision has at least one category. Recipe visibility is `PRIVATE`, `MEMBERS_ONLY`, or `PUBLIC`; private published recipes may additionally be exposed through stored, opaque, revocable share-link tokens. Recipe detail responses provide session-specific edit and share capabilities for the recipe-detail actions.

An ingredient usage contains either a normalized ingredient reference or a non-empty text override. Text overrides support non-ingredient recipe entries such as prepared components and oven settings. A text override can have a special entry kind: no icon, remove, add, information, important, cook, cool, heat, wait, or work step. The editor keeps amount, unit, and optional controls visible for every entry. The API ignores these values for special entry kinds.

The recipe editor retrieves at most twenty matching ingredients for a non-empty ingredient search query. The web client delays each ingredient-search request by 300 milliseconds and does not request or render catalogue ingredient results for an empty query.

The recipe editor presents one note input for every recipe step entry. A normalized ingredient stores this input as its ingredient note. Free-text and special entries store it as their text override.

Recipe detail responses identify whether each ingredient usage references a normalized ingredient. Web clients render normalized ingredient names prominently and render their notes as secondary text.

Recipe detail responses provide ingredient and unit public identities for shopping-list aggregation. Shopping lists aggregate non-special ingredient usages by ingredient identity, optional status, and unit identity for the selected recipe variant.

Suggested structure:

```text
category
--------
id
tenant_id / owner scope
public_id
name
slug
parent_id NULL
```

Many-to-many recipe/category relations are revision-aware where category membership forms part of a published recipe state.

---

## 9. Ingredients and normalization

### 9.1 Ingredient identity

Ingredients are normalized entities.

"Butter" is one ingredient identity across all usages that map to the same local ingredient record.

A recipe must never store its source of truth as a string such as:

```text
"100 g weiche Butter"
```

Instead:

```text
IngredientUsage
├── ingredient = Butter
├── amount = 100
├── unit = g
└── modifiers = [soft]
```

Rendering the human-readable string is an output concern.

### 9.2 Ingredient aliases

Ingredients may have aliases.

Examples:

```text
Ei
Eier
Hühnerei
```

Aliases support:

- autocomplete,
- search,
- imports,
- federation mapping,
- user-entered pantry lists.

### 9.3 Ingredient usage

Ingredients are not stored directly as fields on a recipe step.

A step owns one or more IngredientUsage records.

```text
RecipeStep
└── IngredientUsage *
    ├── Ingredient
    ├── Amount
    ├── Unit
    ├── Optional
    └── Modifiers *
```

This supports the side-by-side Shadowcook UI naturally.

### 9.4 Usage modifiers

Modifiers describe the state/preparation of an ingredient usage, not ingredient identity.

Examples:

- soft,
- melted,
- cubed,
- finely chopped,
- grated,
- room temperature.

Modifiers should be normalized entities rather than arbitrary free-text values where possible.

A usage may additionally contain a free-form note for cases that cannot be represented cleanly as structured modifiers.

Example:

```text
modifier = soft
note = "but not liquid"
```

### 9.5 Optional ingredients

`optional` is semantic recipe data and must not be represented as a modifier string.

It should be an explicit property of IngredientUsage.

---

## 10. Pantry matching

Normalized ingredients enable:

> "I have these ingredients at home. What can I cook?"

V2.0 matching is identity-based.

Example:

```text
Pantry:
- Butter
- Sugar
- Egg
- Flour
- Milk
```

Recipes can be grouped into:

- fully cookable,
- missing one ingredient,
- missing two ingredients,
- etc.

Recipe matching should use distinct required ingredient identities from the effective selected recipe variant.

Optional ingredients should not block a recipe match.

Quantity-aware pantry matching is a later extension.

---

## 11. Units

### 11.1 Unit model

Units are normalized records and may be defined by the local tenant/instance catalogue model.

Units should include enough information for mathematical same-dimension conversion where possible.

Example:

```text
Unit
├── name
├── symbol
├── dimension
├── base factor
└── optional offset
```

Instance-owned units have no owner tenant. The server converts an amount to its dimension base value as `amount × base factor + base offset`, then converts that base value to the target unit. Only temperature units may have a non-zero base offset.

Seeded standard units have a stable `localization_key`. Web clients resolve their localized names and symbols from that key. Units without a `localization_key` are administrator-defined and use their stored name and symbol without translation. Recipe ingredient usages store a unit reference and receive the unit localization key with the recipe detail response.

Seeded standard ingredients and their aliases have stable `localization_key` values. Web clients resolve localized ingredient and alias names from these keys. Administrator-defined ingredients and aliases have no localization key and use their stored names without translation. Recipe ingredient usages store an ingredient reference and receive its localization key with the recipe detail response.

Ingredient translations and ingredient aliases are separate concepts. A future ingredient translation stores one preferred display name for an ingredient and locale. A future ingredient alias stores an additional recognized name for an ingredient and locale. Tenant-owned ingredients will support tenant-managed translations and aliases. Recipe ingredient usages continue to reference ingredient identities rather than translated names.

Examples of dimensions:

- MASS
- VOLUME
- COUNT
- TEMPERATURE

### 11.2 Same-dimension conversion

Conversions such as:

```text
g ↔ kg ↔ oz ↔ lb
ml ↔ l ↔ US cup ↔ tbsp
```

are pure unit conversions and can be implemented in V2.0.

The user-selected/original recipe unit should remain stored as authored. Normalization is used for computation, not destructive rewriting.

### 11.3 Ingredient-specific cross-dimension conversion

Conversions such as:

```text
1 US cup sugar → grams
1 cup flour → grams
```

are not generic unit conversions. They depend on ingredient properties and sometimes preparation state.

This is deferred to a later release such as V2.5.

Potential future model:

```text
IngredientConversionProfile
├── Ingredient
├── Source Dimension
├── Target Dimension
├── Factor / Rule
├── Modifiers / Conditions
├── Data Source
└── Precision / Confidence
```

---

## 12. Recipe variants

### 12.1 Concept

Every recipe has one or more variants.

Exactly one variant is the recipe's default variant.

The default variant is always visible.

The default variant is not a special "base" implementation primitive. It is simply the variant shown when no alternate variant is selected.

### 12.2 Step membership

RecipeStep belongs to the Recipe, not to a variant.

Variants reference recipe steps through direct inclusion state.

Changing a shared recipe step changes it for every variant that includes that step.

### 12.3 Structure

```text
recipe_variant
--------------
id
recipe_revision_id
public_key
name
slug
is_visible

recipe_step
-----------
id
recipe_revision_id
step_key
sort_order
instruction

recipe_variant_step_override
----------------------------
variant_id
step_id
state = INCLUDE
```

### 12.4 Variant deletion

Deleting a variant requires removing that variant from every included recipe step.

### 12.5 Default variant deletion

Deleting the current default variant requires selecting a replacement default as part of the same transaction.

### 12.6 Variant API and reader resolution

Variant edits operate on the mutable recipe draft. Creating, updating, or deleting a variant creates a draft from the published revision when necessary.

The variant API exposes stable `variant_key` values and recipe-step row IDs.

Published recipe reads resolve the default variant when no `variant` slug is requested. A requested variant slug resolves that published revision's effective step state.

Variant visibility controls whether a non-default variant is offered to recipe readers. It does not affect step membership.

---

## 13. Recipe revisions

### 13.1 Draft vs published state

Each recipe has at most one mutable draft.

Published revisions are immutable.

A revision is created as a meaningful recipe version at publish time, not for every edit operation.

An AI agent may make hundreds of edits to a draft; publishing that draft creates one published historical revision.

**Publishing is a lifecycle operation, not a privacy decision.**

`PUBLISHED` means that a revision is the recipe's active reader/UI state. It does **not** mean that the recipe is available to everyone. Whether a caller may read that published revision is decided separately by the recipe's effective visibility and sharing/access policy.

This means all of the following are valid states:

```text
PUBLISHED + PRIVATE
PUBLISHED + AUTHENTICATED
PUBLISHED + PUBLIC
```

A recipe may therefore be developed over multiple published revisions while remaining private the entire time. This allows normal history, comparison, and rollback before the owner ever exposes the recipe to a wider audience.

A draft is never exposed to ordinary readers merely because the recipe's visibility is `PUBLIC`. Draft access remains restricted to principals with editing/review permissions.

### 13.2 Snapshot model

V2.0 uses complete recipe-state snapshots for published revisions.

This deliberately prioritizes simplicity, correctness, reliable rollback, and straightforward historical rendering over storage micro-optimization.

At realistic cookbook sizes, recipe text and relational metadata are small compared with media.

If extremely large deployments eventually require it, the physical storage representation may later evolve to compression, partitioning, archive storage, or copy-on-write without changing the public revision contract.

### 13.3 Suggested structure

```text
recipe
------
id
tenant_id
public_id
slug
published_revision_id
draft_revision_id
visibility_override NULL

recipe_revision
---------------
id
recipe_id
revision_no
status = DRAFT | PUBLISHED | ARCHIVED
created_at
created_by
published_at
version
```

Revision-owned data includes:

- recipe metadata that forms part of the published state,
- variants,
- steps,
- variant overrides,
- ingredient usages,
- category membership.

Visibility and access policy are recipe/tenant policy, not recipe-content state. They therefore do not need to be copied into every content revision. Policy changes should be auditable separately, but making a recipe private/public does not by itself create a recipe-content revision.

Global catalogue entities such as Ingredient, Unit, and Modifier are referenced rather than cloned into each recipe revision.

### 13.4 Stable logical keys

Entities that must be compared across revisions receive stable logical keys in addition to row IDs.

Examples:

- `step_key`,
- `variant_key`,
- `usage_key`.

This supports:

- revision diffs,
- federation merges,
- agent edits,
- conflict reporting.

### 13.5 Publish

Publishing is an atomic operation.

Conceptually:

```text
BEGIN

validate draft
mark old published revision archived
mark draft published
recipe.published_revision_id = draft.id
recipe.draft_revision_id = NULL

COMMIT
```

Reader-facing endpoints always resolve recipe content through `published_revision_id`. Authorization then determines whether the caller may receive that published state.

### 13.6 Restore/rollback

A historical revision should not be mutated or simply reused as the active pointer if doing so would break history semantics.

Preferred rollback flow:

```text
historical revision
→ clone to new draft
→ publish as a new revision
```

History therefore remains linear and auditable.

### 13.7 History inspection

Tenant principals with `recipe:revision:read` can list published and archived revisions and read a complete immutable snapshot for each revision.

Revision snapshots expose recipe metadata, category membership, ordered steps, ingredient usages, variants, and variant step membership. The editor presents a selected revision alongside its immediately preceding published revision and identifies changes by stable step, usage, and variant keys.

Published revisions retain their UTC publication timestamp after archival. Draft revisions do not have a publication timestamp.

Revision inspection does not restore, mutate, or create a draft from a historical revision.

---

## 14. Audit events

Revision snapshots are the source of recipe history.

Audit events record how editors and agents reached a draft state.

Audit/event data is not the source of truth for rendering a recipe.

Suggested fields:

```text
audit_event
-----------
id
tenant_id
principal_id
recipe_id
revision_id
operation
entity_type
entity_key
before_json
after_json
request_id
created_at
```

Detailed edit events may use configurable retention in large installations.

Published recipe revisions should be retained indefinitely unless a tenant explicitly removes them according to a future deletion policy.

---

## 15. Authentication and access management

### 15.1 Principal model

Authentication resolves to a Principal.

```text
Principal
├── HumanUser
└── ServiceAccount
```

Human users should normally authenticate through secure session cookies in browser contexts.

Service accounts and automation use scoped API credentials.

### 15.2 Roles and permissions

Roles are convenience collections of explicit permissions.

### 15.2.1 Tenant management roles

- `administrator` and `tenant-manager` are the only instance-wide roles.
- Only an `administrator` can assign or remove instance-wide roles.
- `Tenant-Manager` is the user-facing name of the `tenant-manager` instance-wide role.
- A Tenant-Manager can create tenants and manage users, tenant-role assignments, and invitations for every tenant.
- A Tenant-Manager cannot assign or remove `administrator` or `tenant-manager` roles.
- `Tenant-Owner` is a tenant-scoped role for complete administration of one tenant.
- A Tenant-Owner can manage users, roles, cookbook content, settings, and service accounts only within the tenant in which the role is assigned.
- Tenant-Manager permissions do not make the assignee a Tenant-Owner of any tenant.
- Tenant-user invitations select exactly one tenant role and assign the accepted account to that tenant with the selected role.

Example permissions:

```text
recipe:read
recipe:create
recipe:update
recipe:delete
recipe:publish

variant:read
variant:create
variant:update
variant:delete

ingredient:read
ingredient:create
ingredient:update

category:read
category:update

service-account:manage
```

Service accounts should normally receive least-privilege permissions.

### 15.2.2 Implemented access structure

- `principal` is the authenticated actor identity.
- `user_account` is a human principal with an optional password verifier. Email addresses are unique among accounts whose `deleted_at` is null.
- User deletion sets `deleted_at` and `disabled_at`, retains the user account and its principal relationships, revokes active sessions, and releases the email address for a later account.
- User deactivation sets `disabled_at` and revokes active sessions. Password-reset tokens are opaque, SHA-256-hashed database records with a one-hour lifetime and single-use consumption.
- An administrator password-reset request revokes active sessions, sets `password_change_required`, and sends a reset link to the registered email address. Completing the linked reset replaces the password verifier and clears `password_change_required`.
- A user-requested password reset sends the same reset-link type without changing `password_change_required`; its request endpoint returns no account-existence information and limits email delivery to one request per account in ten minutes.
- Display names are not unique.
- `user_invitation` stores a SHA-256 verifier of an opaque seven-day invitation token, the invited email address, the creator principal, and acceptance state.
- Instance administrators invite a user by email only. The invitation acceptance page creates the account with the invited email address and the user-selected display name, then redirects to `/login`. It requires a password unless the instance login mode is `EMAIL_CODE_ONLY`.
- `instance_role` is an instance-wide role. The seeded `administrator` role has every registered permission.
- `principal_instance_role` assigns an instance role to a principal.
- `tenant_role` is tenant-scoped. `tenant_membership` associates a principal with a tenant and `tenant_membership_role` assigns its tenant roles.
- `permission` is the canonical permission catalogue. Role-permission relationships are stored in `instance_role_permission` and `tenant_role_permission`.
- Tenant-role names and their permission assignments are tenant data. The initial tenant-role set will be `Owner`, `Editor`, and `Viewer`.
- Instance administrators can list assignable instance roles and replace a user's instance-role assignments through `/admin/users/{publicId}/instance-roles`.
- Tenant members with `tenant:manage` can list only users of their own tenant and replace roles only for existing memberships through `/cookbook/tenant-users`. Instance administrators and Tenant-Managers can use the same endpoints for every tenant.
- Tenant-user role assignment verifies every assigned role belongs to the managed tenant.
- `user_session` stores a SHA-256 verifier of an opaque browser session token. The plaintext token is only held in the `shadowcook_session` HttpOnly cookie.
- Non-development session cookies include the `Secure` attribute. Development session cookies omit it for local HTTP access.
- The web client caches the session presentation state and granted or denied administration-access results in per-tab session storage for 15 minutes. API authorization continues to validate the opaque session and permissions server-side for every protected request.
- Administration navigation uses browser History API transitions within its React island. Administration URLs remain directly reachable and links preserve their normal behavior for modified clicks and new tabs.

### 15.2.3 Bootstrap administrator and password recovery

- API startup creates one instance administrator when no principal holds the `administrator` instance role.
- With `NODE_ENV=development`, the bootstrap account is `admin@local` with password `admin` and `password_change_required` is `false`.
- Outside development, the bootstrap account email is `BOOTSTRAP_ADMIN_EMAIL`; its default is `admin@localhost`.
- Outside development, the bootstrap password is cryptographically generated and is emitted once in the API process log with the bootstrap email.
- Outside development, bootstrap passwords and all maintenance-reset passwords set `password_change_required` to `true`.
- `POST /auth/login` creates a browser session and reports `passwordChangeRequired`.
- `POST /auth/change-password` clears `password_change_required` after current-password verification.
- A session whose user has `password_change_required` can access only the login, password-change, health, session, and logout endpoints.
- The `maintenance reset-password <email>` command reads the new password from `NEW_PASSWORD`, revokes the user's existing sessions, and requires a password change at the next login.
- `apps/web` is the Astro web application. In development, its Vite proxy forwards `/auth` requests to the local API process.

### 15.3 API tokens

Service/API tokens are opaque random bearer tokens.

The plaintext token is shown only when created.

The database stores only a verifier/hash plus metadata such as:

```text
principal_id
name
token_prefix
token_hash
expires_at
last_used_at
revoked_at
created_at
```

- `service_account` has one `SERVICE_ACCOUNT` principal and belongs to exactly one tenant.
- A service account has a tenant membership and one or more tenant roles; it cannot receive an instance role.
- `api_token` stores only a SHA-256 token verifier, an eight-character token prefix, lifecycle timestamps, and the owning service account.
- A token is accepted through the `Authorization: Bearer <token>` header only while the token, service account, and principal are active.
- Every accepted bearer token updates its `last_used_at` timestamp in UTC.
- Creating a token returns its plaintext value once. Token listing returns metadata only.
- Disabling a service account disables its principal and revokes all of its active API tokens.
- Service-account credentials use the same tenant-scoped authorization checks and recipe draft endpoints as browser sessions.
- `POST /mcp` is a remote Model Context Protocol endpoint for active service-account bearer tokens.
- The MCP endpoint exposes tools for recipe search, draft retrieval, draft creation, draft metadata updates, and draft step replacement.
- MCP tools do not publish or delete recipes.
- MCP user connections use OAuth 2.1 authorization-code flow with S256 PKCE and the `shadowcook:recipes` scope.
- `/.well-known/oauth-protected-resource` publishes the MCP resource metadata. `/.well-known/oauth-authorization-server` publishes authorization-server metadata.
- OAuth authorization codes expire after five minutes and have one-time use. Access tokens expire after one hour. Refresh tokens expire after thirty days and rotate on use.
- OAuth access tokens represent authenticated human principals and are constrained by their existing tenant memberships and permissions.
- `PUBLIC_API_ORIGIN` is the canonical public HTTPS API origin used in MCP OAuth discovery and token audience binding. It defaults to `${PUBLIC_WEB_ORIGIN}/api`.

### 15.4 AI agents

AI agents are service accounts, not special superusers.

A recipe curator agent may receive permissions such as:

```text
recipe:read
recipe:create
recipe:update
variant:read
variant:create
variant:update
ingredient:read
ingredient:create
```

without receiving:

```text
recipe:delete
recipe:publish
user:manage
service-account:manage
```

Published recipe state must never be directly mutable by agents or humans.

All changes go through a draft.

### 15.5 AI-assisted cooking sessions

Shadowcook treats AI-assisted cooking as a first-class editing workflow rather than as a chat transcript feature.

A cooking session operates on a mutable recipe draft and lets an explicitly authorized AI or other assistant document the real cooking process while the user cooks. The conversation itself is not the source of truth; structured Shadowcook draft state and cooking-session notes are.

Typical flow:

```text
published revision
      │
      └── mutable draft
             │
             ├── cooking session
             │      ├── observations / notes
             │      └── structured draft edits
             │
             └── review / diff
                    │
                    └── publish
```

A cooking assistant may, according to its granted permissions:

- read the current published recipe and active draft,
- create or continue a draft,
- update steps and IngredientUsages,
- add or modify variants,
- record cooking observations without immediately changing recipe instructions,
- compare the draft against the currently published revision,
- summarize changes made during the session.

Observations and recipe edits are separate concepts. For example, `Crust was slightly too dark at 210 °C` may first be stored as a cooking-session note rather than automatically changing the recipe to 200 °C. The user or authorized assistant may later turn an observation into a deliberate draft edit.

The intended model is:

```text
What happened?
  -> Cooking Session Notes

What should the recipe say?
  -> Draft

What has been approved as the current cookbook state?
  -> Published Revision
```

Publishing remains a deliberate lifecycle action. An AI connection may be granted `recipe:publish`, but the recommended default for conversational assistants is draft-editing access without publish permission so the tenant owner can review the resulting diff before publication.

The integration model is AI-provider-neutral. ChatGPT, Claude, a local model, or another agent may all use the same Shadowcook domain API through an appropriate authenticated adapter such as MCP or REST/OpenAPI. Shadowcook does not require recipe-development conversations to be processed by a specific AI provider.

### 15.6 Optimistic locking

Concurrent editor and agent work must be protected through optimistic locking.

Recipe draft revisions should expose a version/ETag.

Updates use the expected version, e.g. `If-Match` semantics.

Conflicting stale writes are rejected and must be reloaded/reconciled.

---

## 16. API design

### 16.1 Reader API/read model

Reader operations are first-class and require no hidden shared reader credentials.

Unauthenticated requests may read recipes whose effective visibility is `PUBLIC`. Authenticated non-member users may additionally read recipes whose effective visibility is `AUTHENTICATED`. Tenant members and explicitly authorized remote tenants are evaluated through their own permissions/grants.

Example namespace:

```text
/api/public/v2/...
```

or equivalent routing through the web layer. The route name does not bypass visibility checks.

### 16.2 Authenticated API

Authenticated editing/admin operations use the common API:

```text
/api/v2/...
```

Authorization determines what a principal may do.

The administration UI, Android client, and AI agents use the same domain API.

### 16.3 PATCH-oriented editing

Agents and editors should be able to modify targeted entities without replacing the entire recipe graph.

Prefer specific endpoints and PATCH semantics where practical.

### 16.4 OpenAPI

The Fastify schema model generates the OpenAPI contract.

OpenAPI is the stable machine-readable API contract for:

- clients,
- generated DTOs,
- AI tooling,
- future MCP adapters.

MCP, if added, is an adapter over Shadowcook's domain API rather than a separate business-logic implementation.

---

## 17. Visibility, discoverability, and sharing model

Shadowcook encourages recipe sharing but never forces it.

Visibility/sharing policy belongs to the Tenant. The instance administrator does not receive a product-level global "disable federation/sharing for all tenants" switch.

A recipe's **publication lifecycle**, **viewer visibility**, **discoverability**, and **federation/sharing rights** are separate dimensions.

### 17.1 Publication is not visibility

`DRAFT` / `PUBLISHED` answers:

> Which recipe revision is the active reader/UI state?

It does not answer:

> Who may see it?

A private recipe may be published repeatedly and therefore accumulate normal immutable revision history while still being invisible to unauthorised users.

### 17.2 Viewer visibility

Each tenant defines a default recipe visibility.

V2.0 supports:

```text
PRIVATE
MEMBERS_ONLY
PUBLIC
```

Semantics:

- `PRIVATE`: no general audience. Only tenant principals with `recipe:visibility-update` may read the published recipe. Explicit share links may grant access.
- `MEMBERS_ONLY`: all members of the owning tenant may read the published recipe. Anonymous and non-member users may not.
- `PUBLIC`: unauthenticated users may read the published recipe.

The tenant stores, conceptually:

```text
tenant.default_recipe_visibility
```

Each recipe may either inherit that default or override it:

```text
recipe.visibility_override = NULL
→ inherit tenant default

recipe.visibility_override = PRIVATE | MEMBERS_ONLY | PUBLIC
→ explicit recipe policy
```

This supports a common workflow such as:

```text
Tenant default: PUBLIC

Recipe "new sandwich experiment": PRIVATE
Revision 1: published privately
Revision 2: published privately
Revision 3: published privately
...
Recipe perfected
→ visibility override removed or changed to PUBLIC
```

No recipe content needs to be rewritten or republished merely to change its audience. Visibility changes are policy changes and should be recorded in the audit log.

### 17.3 Draft visibility

Drafts are never part of the general reader surface.

Even if a recipe's effective visibility is `PUBLIC`, its mutable draft is visible only to principals with appropriate tenant editing/review permissions. General readers always see the current published revision or no recipe at all.

### 17.4 Discoverability

Discoverability is separate from visibility.

A recipe may be readable by a particular audience without being listed in search, tenant feeds, category discovery, or subscription offers.

Conceptually:

```text
DISCOVERABLE
UNLISTED
```

Visibility is the upper access boundary; discoverability never grants access by itself.

The cookbook overview, category navigation, and recipe lists contain only `DISCOVERABLE` recipes for the caller's audience. An `UNLISTED` recipe remains available at its direct recipe URL when the caller satisfies its visibility policy.

Share links are opaque, revocable explicit grants. Creating a share link requires `recipe:visibility-update`; `recipe:update` alone does not permit it. Share links bypass ordinary viewer visibility but do not alter the recipe or tenant visibility policy.

Each active share link is listed in the recipe editor with its creation timestamp and URL. A principal with `recipe:visibility-update` can copy or revoke any active link for that recipe. Share-link tokens are random, opaque credentials; the public resolver compares their SHA-256 hash, while the stored token is returned only from the permission-gated recipe share-link management API.

A share link may have an optional name, no expiry, or one explicit UTC expiry timestamp. An expired link is not resolved or listed as active.

An active share link grants reader access to the current published default recipe variant, including its ingredient usages and ordered preparation steps.

The shared-recipe view returns to the owning cookbook's root route.

Examples:

```text
PUBLIC + DISCOVERABLE
→ anyone can read it and normal discovery may surface it

PUBLIC + UNLISTED
→ anyone with the URL can read it, but it is not normally surfaced

PRIVATE + UNLISTED
→ only explicitly authorized readers can access it
```

### 17.5 Federation/sharing rights

The ability to view a recipe and the ability to sync/import it through Shadowcook federation are related but not identical permissions.

Tenant-to-tenant grants, share invitations, keyed access, and recipe-level sharing rules control explicit cross-tenant synchronization. A recipe being `PUBLIC` does not bypass those federation authorization rules.

This allows Shadowcook to keep human-readable web visibility, discovery, and structured recipe synchronization as separate policy decisions.

### 17.6 Tenant defaults and recipe overrides

A tenant defines defaults for recipe visibility and other sharing/discovery behavior.

An individual recipe may override those defaults.

Explicit recipe-level deny rules take precedence over broader tenant-to-tenant grants where such deny behavior is configured.

The instance does not participate in this policy hierarchy.

### 17.7 Tenant-to-tenant grants

A TenantAccessGrant represents one tenant granting another tenant rights.

It is directional.

```text
Ursula → Petra FULL_SYNC
Petra   → Ursula FULL_SYNC
```

are two separate grants.

"Full sync" is a UI preset over explicit permissions such as:

```text
recipe:list
recipe:read
recipe:revision:read
recipe:sync
```

It does not imply remote edit, delete, or publish access to the owner's cookbook.

### 17.8 Subscription vs access

Access and subscription are separate.

A grant answers:

> May Petra access Ursula's shared recipes?

A subscription answers:

> Does Petra want Shadowcook to periodically surface new recipes from Ursula?

A tenant may have access without subscribing.

---

## 18. Invitation-based trust bootstrap

Users should not exchange API keys or technical tenant IDs manually.

An invitation is a short-lived one-time capability used to bootstrap a tenant-to-tenant relationship.

### 18.1 Cross-instance invite flow

1. Ursula creates an invite with a requested grant preset.
2. Shadowcook sends or displays a one-time invitation link.
3. Petra opens the link.
4. If Petra lives on another instance, the invite is transferred to Petra's home Shadowcook through browser redirection/deep-linking.
5. Petra chooses which local tenant/cookbook should claim the invite.
6. Petra's instance presents the tenant's identity and establishes authenticated federation credentials.
7. Ursula's instance consumes the invite and creates the tenant access grant.
8. The invite token becomes invalid.

The origin instance does not need to know Petra's tenant identity when the invite is created.

### 18.2 Email is delivery, not identity

A mail address may be used to deliver an invite but is not a federation identity.

Changing an email address must not affect tenant trust relationships.

### 18.3 Invite storage

Suggested fields:

```text
tenant_invite
-------------
id
origin_tenant_id
token_hash
requested_permissions
expires_at
claimed_at
claimed_by_tenant_public_id
created_by
```

---

## 19. Cryptographic tenant identity

Cryptographic tenant identity is part of V2.0.

### 19.1 Goals

The identity system must support:

- tenant spoofing resistance,
- authenticated federation requests,
- tenant-to-tenant grant enforcement,
- key rotation,
- tenant migration between instances,
- protection against host/URL identity confusion,
- stable identity across instance moves.

### 19.2 Identity vs location

A tenant is not its hostname.

```text
Identity:
Tenant UUID + cryptographic identity

Location:
Current Shadowcook instance / base URL
```

Hostnames are locators and may change.

### 19.3 Two-level key model

Each tenant has:

1. a long-lived Ed25519 Identity Key,
2. one or more shorter-lived delegated Ed25519 Federation Keys.

The Identity Key is the root of trust.

Federation Keys are used for routine request signing and may be rotated or revoked.

### 19.4 Delegation

The tenant Identity Key signs federation-key delegation records containing at least:

- tenant identity,
- federation public key,
- key ID,
- validity interval,
- optional capabilities/purpose.

Remote tenants validate the delegation before trusting the federation key.

### 19.5 HTTP request signing

Federation requests should use a standardized HTTP message-signing approach rather than a custom concatenation/HMAC protocol.

Requests should cryptographically cover relevant components such as:

- HTTP method,
- authority,
- path,
- content digest,
- creation time,
- expiry time,
- nonce/request identifier.

### 19.6 Replay protection

Signed requests must be short-lived and replay-protected.

Receivers validate:

- signature,
- delegated key validity,
- timestamps,
- nonce uniqueness,
- tenant grant,
- recipe sharing policy.

A valid signature authenticates the tenant; it does not itself authorize recipe access.

### 19.7 Identity-key rotation

Identity keys are not routinely rotated.

If rotation becomes necessary, the old identity key should sign the new identity key and the new key should acknowledge succession where practical.

Remote tenants can then maintain a verified identity chain.

### 19.8 Threat model

Shadowcook assumes the host running a tenant is trusted to operate that tenant's local data.

Cryptographic federation protects against remote peers, network tampering, tenant spoofing, and unauthorized reuse of tenant identity claims.

It cannot fully protect a tenant from a malicious server administrator with root-level access to the host that is actively running the tenant.

---

## 20. Federation and cross-instance recipe sharing

### 20.1 Imported recipes are local forks with upstreams

Importing a remote recipe creates a complete local recipe copy plus upstream metadata.

The local recipe remains usable even if the remote source later:

- deletes the original recipe,
- removes sharing access,
- goes offline permanently,
- moves to another instance.

### 20.2 Federation identity

Remote objects use stable public identities.

The relevant hierarchy is:

```text
Tenant Identity
└── Recipe Public ID
    └── Revision Identity/Number
```

The current instance URL is discovery/location metadata, not the recipe's identity.

### 20.3 Discovery endpoint

Instances should expose a well-known federation discovery endpoint, for example conceptually:

```text
/.well-known/shadowcook
```

It advertises instance identity, supported federation protocol versions, and API entry points.

### 20.4 Pull-based federation

Shadowcook federation is primarily pull-based.

A tenant/server asks another tenant/server for:

- recipe metadata,
- immutable revisions,
- current revision state,
- discovery offers.

A complex ActivityPub-style push federation system is not required for V2.0.

### 20.5 Recipe lineage and fork identity

Every recipe belongs to a stable recipe lineage.

A newly created recipe receives a new globally stable `lineage_public_id`. When that recipe is imported, forked, locally modified, re-shared, or passed through any number of tenants, the lineage ID is preserved.

Recipe identity and lineage identity are deliberately different:

```text
recipe_public_id
    identifies one concrete recipe owned by one tenant

lineage_public_id
    identifies the recipe family from which all forks descend

revision_public_id
    identifies one concrete historical recipe state
```

Example:

```text
Ursula
Recipe U17
Lineage L-ABC
    ↓ sync/fork
Petra
Recipe P92
Lineage L-ABC
    ↓ sync/fork
Anna
Recipe A5
Lineage L-ABC
    ↓
...
    ↓
Thomas
Recipe T41
Lineage L-ABC
```

All local recipe IDs are different. The lineage identity remains the same.

Local edits, renaming, variant creation, ingredient changes, and ordinary upstream merges never generate a new lineage ID.

A new lineage is created only by an explicit user action that intentionally detaches a recipe from its ancestry and declares it to be a new independent recipe family.

### 20.6 Fork provenance

A fork keeps provenance describing both its immediate upstream and, where known, the root origin of the lineage.

Conceptually:

```text
root origin:
    Ursula / Recipe U17

immediate upstream:
    Petra / Recipe P92

local recipe:
    Thomas / Recipe T41

lineage:
    L-ABC
```

Immediate upstream answers:

> Where do normal updates for this local recipe come from?

Lineage/root provenance answers:

> What recipe family does this local fork belong to, and where did that family originate?

Provenance metadata must never bypass visibility or sharing authorization. Private forks are not disclosed merely because another tenant knows the lineage.

---

## 21. Federation entity mapping

Remote database IDs are never meaningful locally.

Ingredients, units, and modifiers must be mapped to local entities.

### 21.1 Persistent mapping

Mappings are stored per remote tenant/instance entity identity and reused across all recipes and revisions from that origin.

Example:

```text
Remote Tenant X
Remote Ingredient UUID A
→ Local Ingredient #17 (Sugar)
```

The user must not be asked to make the same mapping decision for every recipe or revision.

### 21.2 Mapping workflow

For each required remote entity:

1. existing persistent mapping → reuse,
2. unique safe local match → auto-map,
3. ambiguous/no match → ask user.

The user may choose:

- map to an existing local entity,
- create a new local entity.

### 21.3 Ingredients

Ingredient matching may use:

- stable remote ID,
- exact normalized name,
- aliases,
- manually curated mappings.

Manual mappings are never silently overwritten by later matching heuristics.

### 21.4 Units

Units are also server/tenant-defined and require persistent mapping.

Where available, unit dimension and conversion metadata may support safe auto-matching.

Example:

```text
Remote "cup"
VOLUME
236.5882365 ml
→ Local "US Cup"
```

Ambiguous definitions require user confirmation.

### 21.5 Modifiers

The same persistent mapping model applies to normalized usage modifiers when remote and local catalogues differ.

### 21.6 Local normalization boundary

After import mapping is resolved, the imported recipe uses only local entity IDs.

Federation concerns stop at the import boundary.

Internally, an imported recipe behaves like any other local Shadowcook recipe.

---

## 22. Upstream recipe tracking

Imported recipes store upstream metadata.

A local recipe has at most one **primary upstream**. Normal revision updates are accepted only from that primary upstream. Other recipes from the same lineage are related forks, not additional automatic update sources.

Suggested concept:

```text
recipe_upstream
---------------
recipe_id
lineage_public_id
origin_tenant_public_id
origin_recipe_public_id
immediate_upstream_tenant_public_id
immediate_upstream_recipe_public_id
remote_instance_locator
last_merged_remote_revision
latest_known_remote_revision
credential/grant reference
status
last_checked_at
```

Possible statuses include:

- ACTIVE,
- REMOVED,
- ACCESS_LOST,
- UNREACHABLE.

Losing upstream access never deletes the local recipe.

---

## 23. Remote revision updates and merge

### 23.1 Daily update checks

A worker periodically checks imported recipes for newer remote revisions.

Checks should be batched/grouped per remote source rather than sending one request per recipe where possible.

### 23.2 No automatic overwrite

A new upstream revision is offered to the local editor.

Local content is never silently overwritten.

### 23.3 Three-way merge

Remote updates use a three-way merge with:

```text
A = last remote revision merged/imported
B = new remote revision
C = current local recipe state
```

For a field/entity:

```text
Local == Base, Upstream != Base
→ take Upstream

Upstream == Base, Local != Base
→ keep Local

Local == Upstream
→ keep value

Local != Base
AND Upstream != Base
AND Local != Upstream
→ conflict
```

### 23.4 Delete/modify conflicts

If upstream deletes an entity that local did not change:

```text
→ delete in merged draft
```

If upstream deletes an entity that local modified:

```text
→ conflict
```

### 23.5 Stable keys

Stable step/variant/usage keys are required for deterministic merge identity.

String similarity must not be the primary mechanism for deciding whether two historical steps are the same logical step.

### 23.6 Ordering

Step ordering requires merge-aware design.

The initial implementation may use sparse sort keys, but ordering must not assume dense sequential integers that make concurrent insert merges unnecessarily destructive.

A future lexicographic/fractional ordering key is acceptable if needed.

### 23.7 Related forks and trackback

Recipes of the same lineage that are not the local recipe's primary upstream are treated as **related forks**.

A related fork is never used as an automatic update source merely because it shares the same lineage. This prevents circular update paths such as:

```text
Ursula → Petra → ... → Thomas → Petra
```

If sharing and visibility policy allow it, Shadowcook may expose related forks to the local tenant for deliberate comparison.

Example UI concept:

```text
Derived recipes

peter@instance-b.example
"Parmesan Sandwiches"
based on this recipe lineage

[View] [Compare]
```

A compare operation may use lineage and revision provenance to perform a three-way diff and optionally let the user cherry-pick or merge selected improvements.

This is a deliberate user action and does not change the primary upstream automatically.

Fork trackback is visibility-aware:

- a `PRIVATE` fork must not be revealed to unauthorized tenants,
- an `AUTHENTICATED` fork is only visible to eligible authenticated users/tenants,
- a `PUBLIC` fork may be exposed according to discoverability/sharing policy,
- tenant grants may authorize additional visibility,
- Shadowcook must not reveal counts or placeholders that leak the existence of hidden forks.

### 23.8 Revision provenance

Published revisions may retain provenance links to the remote revision(s) they incorporated.

Conceptually:

```text
revision_provenance
-------------------
local_revision_public_id
parent_revision_public_id
relation
```

This forms a revision provenance DAG and allows Shadowcook to recognize that a change seen in a distant fork may already descend from a revision the local tenant has incorporated.

The provenance graph must not be used to bypass sharing authorization.

---

## 24. Tenant subscriptions and recipe discovery

### 24.1 Subscription concept

A tenant may subscribe to another tenant's cookbook.

This is distinct from access grants.

A subscription asks:

> What new recipes is this tenant offering me?

### 24.2 Discovery offers

Remote discovery should return lightweight metadata, not full recipe snapshots.

An offer includes fields such as:

- recipe public ID,
- lineage public ID,
- title,
- slug,
- short description,
- current revision,
- published timestamp,
- optional root/immediate-upstream provenance metadata where visible and useful,
- optional thumbnail metadata.

Before presenting an offer, the receiving tenant checks whether it already owns a local recipe with the same lineage.

If the lineage is unknown locally, the recipe may be offered as new.

If the lineage is already known locally:

- it is **not** presented as a normal new-recipe discovery offer,
- it does **not** become another automatic upstream,
- if authorization permits, it may instead appear as a related fork for explicit `View` / `Compare` workflows.

This rule prevents a recipe from travelling through many tenants and later returning to an earlier tenant as a supposedly new recipe.

### 24.3 Offer decisions

The local user can choose:

- **Sync**
- **Not now**
- **Ignore**

#### Sync

Runs the normal import/mapping workflow and creates a tracked upstream recipe.

#### Not now

The offer is deferred and may appear again later.

Repeated deferrals use increasing backoff.

Suggested schedule:

```text
1st:   1 day
2nd:   3 days
3rd:   7 days
4th:  14 days
5th:  30 days
6th:  60 days
later: 90 days cap
```

Deferral belongs to the remote recipe identity, not a specific remote revision.

#### Ignore

The recipe is suppressed from automatic discovery indefinitely.

Manual import remains possible at any time.

### 24.4 Local offer state

Suggested state:

```text
subscription_recipe_offer
-------------------------
subscription_id
remote_recipe_public_id
state = PENDING | DEFERRED | IGNORED
defer_count
next_offer_at
first_seen_at
last_seen_revision
last_seen_at
```

A locally synced upstream recipe does not need to remain represented as an offer.

### 24.5 Cursor-based discovery

Subscriptions should support incremental polling/cursors so a remote tenant does not need to resend its entire catalogue every day.

---

## 25. Local and remote sharing use the same domain semantics

Tenant-to-tenant sharing must behave the same whether both tenants live on the same instance or different instances.

Same-instance sharing may use direct internal/database operations.

Cross-instance sharing uses the federation transport and cryptographic authentication.

The UI must not expose this implementation difference to normal users.

---

## 26. Tenant migration

A tenant may move from one Shadowcook instance to another while keeping:

- tenant public ID,
- cryptographic tenant identity,
- recipe public IDs,
- recipe lineage IDs,
- recipe history,
- federation provenance/mappings,
- cookbook contents.

Remote tenants should be able to verify an instance-location change using the tenant's cryptographic identity.

The hostname is updated as a locator; tenant identity remains unchanged.

---

## 27. Backup and restore

Portable backup is a Version 2.5 feature.

### 27.1 Backup purpose

Backups support:

- disaster recovery,
- migration,
- protection from host failure,
- avoidance of platform lock-in,
- user-controlled archival.

### 27.2 Reminder

Shadowcook should periodically remind a tenant owner to download a backup.

Suggested default: approximately every 3 months since the last successful backup export.

The reminder is informative, not alarmist, and may be snoozed or disabled.

### 27.3 Backup format

A backup is a Shadowcook-defined portable archive, not a PostgreSQL dump.

Example:

```text
ursulas-cookbook-2026-09-23.shadowcook.zip

manifest.json
tenant.json

catalog/
  ingredients.json
  units.json
  modifiers.json
  categories.json

recipes/
  <recipe-public-id>/
    recipe.json
    revisions.json

media/
  ...

federation/
  upstreams.json
  mappings.json

identity/
  tenant.json
  public-key.json
  private-key...
  key-history.json
```

The backup format has its own version independent of the database schema.

### 27.4 Backup contents

A full portable backup includes:

- tenant metadata,
- recipes,
- complete published revision history,
- active draft where appropriate,
- variants,
- ingredients used/owned by the tenant,
- units/modifiers/categories needed for restore,
- media,
- federation mappings,
- upstream and lineage/fork provenance,
- sharing metadata that is safe to restore,
- tenant cryptographic identity and key history.

### 27.5 Secrets excluded

The normal backup must not blindly contain active operational secrets such as:

- account passwords,
- session cookies,
- API/service tokens,
- invite tokens,
- instance mail/server credentials.

Federation relationships may need re-authorization after restore where operational credentials are intentionally excluded.

### 27.6 Tenant identity in backup

A portable move requires the tenant Identity Private Key.

Backup password protection is optional.

If a password is supplied, the identity private key is encrypted using a password-derived key.

If no password is supplied, the backup remains fully portable and restorable, but Shadowcook must clearly warn that possession of the unencrypted backup allows impersonation of the tenant identity.

The product must not force a password that can make disaster recovery impossible when forgotten.

### 27.7 Backup integrity

The archive manifest should include checksums for backup components so corruption can be detected before restore.

### 27.8 Restore modes

Two conceptual restore modes may be offered:

#### Restore as copy

Creates a new tenant identity from backup content.

Useful for testing or duplication.

#### Move/restore original cookbook

Restores the original tenant public ID and cryptographic identity.

Used for migration and disaster recovery.

### 27.9 Transactional restore

A restore must be validated before partially mutating the target tenant.

Schema/format validation, checksums, mapping analysis, and compatibility checks happen before final commit where possible.

Half-restored cookbooks are unacceptable.

---

## 28. Catalogue ownership and scope

Ingredients, units, and modifiers may require both commonly shared/system catalogue records and tenant-owned custom records.

A practical model is:

```text
owner_tenant_id = NULL
→ system/shared catalogue entity

owner_tenant_id = <tenant>
→ tenant-owned custom entity
```

This allows:

- hosted instances to avoid creating hundreds of thousands of duplicate "Sugar" records,
- tenants to define custom ingredients or units,
- federation mapping to target either shared or tenant-specific local entities.

The exact catalogue-governance UI can evolve independently from the recipe model.

---

## 29. Background workers

Workers include at least:

### 29.1 Upstream revision checker

Checks imported/tracked recipes for remote revisions.

### 29.2 Subscription discovery checker

Polls subscribed tenants for newly offered recipes.

### 29.3 Backup reminder scheduler

Surfaces tenant backup reminders based on last successful export.

### 29.4 Maintenance

Possible tasks:

- expired invite cleanup,
- revoked/expired key cleanup,
- audit retention,
- orphan media cleanup,
- remote health/backoff handling.

Workers should be idempotent where practical.

---

## 30. Security notes

### 30.1 CORS is not authentication

CORS may protect browser interaction boundaries but must never be treated as API authorization.

### 30.2 SSRF protection

Federation causes the Shadowcook server to make remote requests and therefore introduces SSRF risk.

Default federation networking must reject or carefully control:

- localhost,
- private address ranges,
- link-local destinations,
- unsafe redirects,
- unexpected schemes,
- unbounded response sizes,
- excessive timeouts.

Self-hosters may explicitly opt into private-LAN federation if needed.

DNS resolution and redirect targets must be revalidated.

### 30.3 Immutable published revisions

Published revisions are not mutated in place.

### 30.4 Secrets

Operational private keys and tokens should be encrypted at rest where practical using instance-managed secret material/KMS-like mechanisms.

### 30.5 Federation authorization sequence

A remote federation request is accepted only after:

1. cryptographic request verification,
2. delegated federation-key validation,
3. replay/timestamp checks,
4. tenant identity resolution,
5. grant validation,
6. recipe-level sharing policy validation.

---

## 31. Media and storage

Media records are referenced by recipe revisions rather than copied into each revision.

A media object may be reused by many revisions.

Old media required to faithfully restore historical recipe revisions must not be garbage-collected while referenced by retained history.

Large hosted deployments may use:

- object storage,
- CDN,
- lifecycle rules,
- media deduplication/content hashes.

Small installations may use local storage behind the same abstraction.

---

## 32. Scalability strategy

Shadowcook 2.0 should optimize for correctness and maintainability at normal installation sizes without creating conceptual dead ends for large deployments.

### 32.1 Do not prematurely optimize published history

Full revision snapshots are acceptable for V2.0.

A published revision represents a meaningful publication event, not every editor keystroke or API patch.

### 32.2 Large-installation evolution paths

If a hosted service eventually accumulates very large history volumes, compatible storage optimizations include:

- table partitioning,
- archive storage,
- compression,
- cold historical storage,
- copy-on-write physical representation,
- history sharding.

The external recipe revision contract does not depend on the physical representation.

### 32.3 Stateless application services

Web/API services should remain as stateless as practical so horizontal scaling is straightforward.

---

## 33. Version 2.0 scope

The following concepts are considered part of the V2.0 architecture baseline:

- TypeScript/Node backend,
- Astro + React public web,
- Fastify/OpenAPI API,
- PostgreSQL/Kysely persistence,
- multi-tenancy,
- human-readable URLs,
- HTML-first public recipe rendering,
- normalized ingredients,
- IngredientUsage,
- normalized modifiers,
- normalized units,
- same-dimension unit conversion,
- recipe variants with direct step membership,
- draft/published revision snapshots,
- immutable published history,
- audit events,
- human/service principals,
- scoped permissions,
- AI-agent editing,
- tenant-owned recipe visibility defaults with per-recipe overrides,
- published-but-private recipe history,
- recipe discoverability.

---

## 34. Version 2.5 scope

The following concepts are planned for Version 2.5:

- media upload, storage, rendering, and lifecycle management,
- pantry ingredient matching,
- portion scaling, timers, cooking mode, favorites, and AI-assisted cooking sessions,
- tenant-owned federation sharing policy,
- tenant-to-tenant grants,
- invitation-based trust bootstrap,
- cryptographic tenant identity and delegated federation keys,
- pull-based federation,
- recipe import/fork with upstream tracking,
- persistent ingredient/unit/modifier federation mapping,
- remote revision checks and three-way merge/conflict handling,
- tenant subscriptions and sync offers,
- portable backup/restore and optional backup encryption,
- tenant migration,
- background workers for upstream checks, subscription discovery, backup reminders, and maintenance.

---

## 35. Deferred / later features

Likely later additions include:

### 35.1 Ingredient-specific mass/volume conversion

Example:

```text
1 US cup sugar → grams
```

Requires curated density/conversion data and possibly modifier-aware conversion rules.

Target: approximately V2.5 or later.

### 35.2 Quantity-aware pantry inventory

Track not only whether an ingredient exists, but whether enough is available.

Requires robust unit conversion and inventory semantics.

### 35.3 Ingredient substitution graph

Examples:

- shallot ↔ onion substitution,
- powdered sugar can be made from sugar,
- configurable substitution quality.

Not required for V2.0.

### 35.4 Rich portable tenant-location discovery

Automatic discovery of a tenant after migration may evolve beyond direct known locators.

The cryptographic identity model is designed to support this later.

---

## 36. Core invariants

These invariants should be treated as design/test requirements.

### Recipe and variants

1. Every recipe has at least one variant.
2. Every recipe has exactly one default variant.
3. The default variant is visible.
4. A recipe step may be included in zero or more variants of the same recipe revision.
5. Deleting a variant is permitted only when no recipe step is included in it.
6. Recipe steps belong to recipes/revisions, not exclusively to variants.

### Revisioning

7. Published revisions are immutable.
8. A recipe has at most one mutable draft.
9. Reader-facing requests resolve only published state; drafts are never exposed by general recipe visibility.
10. Edit operations do not automatically create published revisions.
11. Publishing selects the active reader/UI revision and does not imply public visibility.

### Ingredients

12. Ingredient identity is separate from IngredientUsage.
13. Preparation state belongs to usage modifiers, not ingredient identity.
14. Remote/local ingredient mapping is persistent and identity-based.

### Tenancy, visibility, and sharing

15. Every tenant-owned resource is tenant-scoped.
16. Tenant sharing and visibility policy are owned by the tenant, not by instance administration.
17. Every tenant defines a default recipe visibility.
18. Every recipe may override its tenant's default visibility or inherit it.
19. `PRIVATE`, `AUTHENTICATED`, and `PUBLIC` describe audience and are independent of `DRAFT` / `PUBLISHED`.
20. Visibility changes do not require a new recipe-content revision.
21. Discoverability does not grant read access.
22. A service account acts within explicit tenant membership/permissions.
23. AI-assisted cooking conversations are not recipe state; structured draft data and cooking-session notes are the source of truth.
24. Cooking-session observations do not implicitly mutate recipe instructions unless converted into an explicit draft edit.

### Federation

25. Imported recipes are local copies and survive upstream deletion/unavailability.
26. Remote database IDs are never trusted as local IDs.
27. Federation mappings persist across recipe revisions and future imports.
28. Remote updates never silently overwrite local recipe state.
29. Cross-instance merges are based on three-way merge semantics.
30. Every recipe has a stable lineage identity that survives import, local modification, re-sharing, and ordinary upstream merges.
31. A tenant normally owns at most one local recipe per lineage.
32. Tenant subscriptions discover unknown lineages, not merely unknown local recipe IDs.
33. A tenant must never receive a normal new-recipe discovery offer for a lineage it already owns.
34. A local recipe has at most one primary upstream for automatic revision updates.
35. Other visible recipes of the same lineage are related forks and never become automatic update sources without an explicit user action.
36. Creating an upstream relationship must not introduce a cycle in recipe provenance.
37. Fork trackback and lineage views obey the same visibility, grant, and sharing rules as recipe access and must not leak hidden fork existence.
38. Detaching a recipe from its lineage is an explicit action that creates a new lineage identity.

### Identity and authorization

39. Tenant identity is independent of hostname.
40. A valid cryptographic identity does not imply authorization.
41. Tenant grants, recipe visibility, and recipe sharing policies are checked separately from authentication.
42. Federation requests are replay-protected.

### Backup

43. A tenant can export a portable full backup.
44. Recipe history is included in a full backup.
45. Tenant identity can be restored/migrated.
46. Backup password protection is optional.
47. An unencrypted identity-bearing backup triggers a clear security warning but remains supported.

---

## 37. Mental model

A concise way to think about Shadowcook 2.0:

```text
INSTANCE
  hosts infrastructure

TENANT
  is a cookbook identity

PRINCIPAL
  acts inside a tenant

RECIPE
  belongs to a tenant

REVISION
  is an immutable published recipe state

VISIBILITY
  answers who may read the published recipe

DISCOVERABILITY
  answers whether eligible readers are likely to find it

VARIANT
  is a named recipe configuration with direct step membership

STEP
  describes preparation

INGREDIENT USAGE
  attaches a normalized ingredient, quantity, unit, and modifiers to a step

GRANT
  answers whether another tenant may access shared content

SUBSCRIPTION
  answers whether a tenant wants new-content offers from another tenant

LINEAGE
  identifies the recipe family across tenants and forks

UPSTREAM
  identifies the single primary remote source for normal updates of a local fork

RELATED FORK
  is another visible recipe of the same lineage that may be viewed/compared but is not an automatic update source

REVISION PROVENANCE
  records which historical remote/local revisions contributed to a published state

FEDERATION MAPPING
  translates remote catalogue identities into local catalogue identities

COOKING SESSION
  records real cooking observations and deliberate draft edits without making the conversation itself authoritative

TENANT IDENTITY KEY
  proves who the tenant is

FEDERATION KEY
  signs routine tenant-to-tenant traffic

BACKUP
  makes ownership and portability real
```

---

## 38. Legacy data migration

Existing Shadowcook installations must have a one-way migration path into the Shadowcook 2.0 data model so that existing recipes are not stranded.

This migration is a deployment/upgrade concern, not a compatibility constraint on the Shadowcook 2.0 architecture. Shadowcook 2.0 does not need to preserve legacy API contracts or legacy persistence structures.

The detailed migration strategy is intentionally deferred until the Shadowcook 2.0 schema and import APIs are stable. The eventual migration tooling should reuse normal domain/import validation wherever practical rather than bypassing the model with direct database copying.

---

## 39. Tenant ingredient catalogues

Tenant-owned ingredients and aliases are stored in the shared normalized ingredient catalogue with `owner_tenant_id` set to the owning tenant. Instance-owned standard ingredients have a null owner tenant.

Recipe-editor catalogue search returns instance-owned and current-tenant ingredients. It searches canonical names and aliases and returns an exact-match indicator for the submitted search value.

Tenant ingredient administration and on-the-fly ingredient creation use tenant ingredient permissions. Tenant ingredient administration exposes only ingredients owned by the current tenant.

Tenant-owned units of measure use the shared normalized unit catalogue with `owner_tenant_id` set to the owning tenant. Tenant unit administration exposes only units owned by the current tenant. Recipe-editor unit selection includes instance-owned and current-tenant units.

## 40. Architectural direction

Shadowcook 2.0 is a content-first, tenant-owned, federated cookbook platform whose architecture deliberately treats recipes as portable, shareable, versioned domain objects.

The intended result is that Ursula and Petra can exchange recipes as naturally as people have always exchanged recipes, while Shadowcook handles identity, synchronization, history, conflict resolution, and transport behind the scenes.

At the same time, a technical user may self-host the exact same software, connect AI agents, expose public recipes, automate curation, and migrate the entire cookbook without depending on a central Shadowcook service.

That combination is the defining architectural direction of Shadowcook 2.0.
