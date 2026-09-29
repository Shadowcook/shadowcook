# Shadowcook 2.0 implementation progress

## Completed architecture features

### Platform, persistence, and development data

- The pnpm workspace contains the Fastify API, Astro web application, database package, and OpenAPI contract.
- PostgreSQL uses the initial normalized schema for tenants, principals, roles, catalogues, recipes, immutable revisions, media, audit events, cooking sessions, sharing, federation upstreams, and mappings.
- API startup runs transactional, advisory-lock-protected migrations with recorded checksums and UTC timestamps before binding its HTTP listener.
- The API exposes the health endpoint and documented API contract.
- Development startup creates the local cookbook, local accounts, categories, recipes, revisions, variants, steps, ingredients, units, and ingredient usages from the JSON development seed.
- The tracked initial-deployment seed creates localized instance-owned units, ingredients, and aliases.
- `pnpm reset:shadowcook-db` and its `pnpm reset:dev-db` alias recreate only the `public` schema of the development `shadowcook` database.

### Cookbook, public web, and localization

- The Astro application provides server-rendered, deep-linkable tenant selection, category, recipe, variant, sign-in, and administration routes, with same-origin API forwarding.
- Cookbook overview and recipe-detail APIs provide tenant-scoped published content, category trees, ordered steps, ingredient usages, reader capabilities, and variant resolution.
- Public cookbook access supports public recipes; authenticated users additionally receive accessible tenant recipes.
- Category and recipe slugs are tenant-unique, route segments are reserved in the database, and cookbook navigation supports root recipe URLs, category paths, and breadcrumbs.
- Category management supports hierarchical creation, renaming, reparenting, guarded deletion, and adjacent sibling ordering.
- The web client uses localized English and German UI dictionaries for UI text, metadata, accessibility labels, and API errors; authored recipe text remains unchanged.
- Cookbook code is organized under `apps/web/src/features/cookbook`; shared browser-session and API infrastructure is under `apps/web/src/lib`.

### Recipe authoring, revisions, and variants

- Recipes use mutable drafts and immutable published revisions, with category assignment, publication, incrementing versions, and draft lists on deep-linkable tenant management routes.
- Recipe steps contain normalized ingredient usages, free-text overrides, optional values, notes, and semantic special-entry kinds.
- Ingredient search is delayed and server-backed, searches aliases, and supports creating tenant ingredients during editing.
- Published recipe details render step-oriented ingredients and preparation, special-entry icons, normalized ingredient notes, and aggregated shopping lists.
- Recipe variants have stable keys, direct step membership, one visible default variant, draft APIs, and reader resolution by optional variant slug.
- Recipe creation, draft creation, and the development seed create and preserve default variants, stable step keys, variant keys, and direct step memberships.
- Recipe visibility supports private and public published recipes and opaque, tokenized share links.

### Catalogues and units

- Instance administration manages instance-owned units with same-dimension conversion validation and usage-aware deletion protection.
- Standard units, ingredients, and aliases use localization keys; administrator-defined catalogue records retain their stored presentation.
- Tenant management provides deep-linkable ingredient, alias, and unit CRUD.

### Authentication, authorization, and administration

- Human password authentication, email-code authentication, opaque HttpOnly sessions, password-change enforcement, password resets, and bootstrap administration are implemented.
- One-time email codes are hashed, expiring, rate-limited, and delivered through configured SMTP.
- SMTP configuration is permission-gated, encrypts stored passwords, and supports test delivery.
- The authorization model includes canonical permissions, instance roles, tenant roles, tenant memberships, tenant-scoped role assignment, and the initial `Owner`, `Editor`, and `Viewer` roles.
- Tenant-Manager and administrator capabilities cover tenant lifecycle management, invitations, users, and role assignments within their defined scopes.
- Instance administration provides deep-linkable dashboards and tenant, user, authentication, SMTP, ingredient, and unit management.
- Middleware protects administration and tenant-management routes, preserves validated post-login navigation, and the web client validates restored sessions with the API.
- Instance-administration UI code is organized under `apps/web/src/features/admin`.
