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
- Bundled Font Awesome icon packages

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
- Supported UI locales are `en` and `de`. `PUBLIC_DEFAULT_LOCALE` selects the fallback locale at build time; an unset or unsupported value falls back to English.
- The global head bar provides a language-icon dropdown with English and German choices for authenticated and anonymous users. The active language is marked in the dropdown.
- The selected locale is stored in the host-only `shadowcook_locale` cookie with `Path=/`, a 365-day maximum age, `SameSite=Lax`, and `Secure` on HTTPS. The preference is independent of the authentication session and remains after sign-out.
- Astro resolves the locale from the request cookie before rendering every web page, including metadata and HTML language attributes. Missing, malformed, and unsupported preferences use the configured fallback locale.
- Changing the language reloads the current URL, preserving its path, query parameters, and fragment.
- Recipe text remains authored content and is not translated by the UI locale system.

#### Application dialogs

- `apps/web/src/components/Dialog.tsx` provides the shared modal shell. It renders a styled HTML `dialog` through a portal into the document body and uses `showModal()` for modal focus containment and background interaction blocking.
- `MessageDialog.tsx` provides `information`, `error`, and `confirmation` variants with Font Awesome pictograms, locale-resolved default titles and buttons, and optional additional content and action labels.
- Dialogs have unique accessible title and description identifiers. Information uses the `dialog` role; errors and confirmations use `alertdialog`.
- Escape dismisses a dialog or cancels a confirmation. Confirmations initially focus the cancel action. Busy dialogs disable their actions and Escape dismissal. Backdrop clicks do not dismiss dialogs. Closing restores focus to the previously focused element when it remains in the document.
- Application code does not call browser-native `alert()`, `confirm()`, or `prompt()`. A web unit test checks application sources for native-dialog references.
- Request-error popups, recipe-draft discard confirmations, ingredient-merge confirmations, administrator deletion and password-reset confirmations, and newly created service-account token information use `MessageDialog`.

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
- Database migration statements are stored as `YYYYmmddHHiiss_descriptive_name.sql` files in `packages/db/src/migrations/sql`, where the prefix is a UTC timestamp. The database package loads every SQL file in lexicographic filename order as a runtime asset.
- Migration execution uses a PostgreSQL advisory lock named `shadowcook-schema-migration`.
- Each migration is executed in one database transaction.
- Applied migration identifiers, SHA-256 checksums, and UTC application timestamps are stored in `application_schema_migration`.
- A migration checksum mismatch or an unknown applied migration stops API startup.
- The API process loads the optional repository-root `.env` file only as a local-development convenience. Existing process environment variables remain authoritative.

### 4.1.1 Automated test execution

- `pnpm test` executes the unit, API integration, API contract, migration, and browser end-to-end test commands sequentially, prints a pass/fail result for every suite, prints an overall pass/fail result, and exits unsuccessfully when any suite fails.
- API integration, API contract, and migration tests create a dedicated disposable PostgreSQL Docker container named with the `shadowcook-test-` prefix.
- Each disposable test container has a randomly assigned loopback TCP port, a generated database password, a fresh `shadowcook_test` database, and is removed after its test suite.
- Test database migrations run through `migrateDatabase`; test execution does not read or modify `DATABASE_URL`, development databases, production databases, or configured development ports.
- API tests construct Fastify with `createApi` and execute requests through Fastify injection without binding an HTTP port.
- Unit tests use the Node.js test runner through `tsx` and cover deterministic API functions without PostgreSQL or HTTP transport.
- Web proxy unit tests use the Node.js test runner with native TypeScript support and mocked upstream responses. `pnpm test:unit` runs both API and web unit tests.
- `pnpm --filter @shadowcook/web test:proxy` builds the web runtime and runs HTTP proxy integration tests with an isolated web listener and mock API listener on randomly assigned loopback ports.
- Priority-0 API integration tests cover login validation, HttpOnly session creation, logout revocation, disabled and expired sessions, password-change-required access restrictions, and the separation of tenant roles from instance permissions.
- Priority-0 API integration tests verify category tenant isolation for tenant-slug and category-public-ID routes, including cross-tenant list, create, and update attempts.
- `pnpm test:e2e` is reserved for the browser test suite and currently reports that browser end-to-end tests have not been implemented.

### 4.2 Cookbook overview

- `GET /cookbook` returns publicly visible published recipes without authentication and all published recipes for tenants in which the authenticated user's principal is a member.
- Every recipe has an `is_featured` flag. New recipes default to featured. Only published, discoverable, accessible featured recipes are eligible for the tenant cookbook root front page.
- A tenant stores its front-page featured-recipe count from 1 through 100. The default is 4. Tenant managers configure this count in General settings.
- A tenant optionally stores a front-page heading with 1 through 80 non-whitespace characters. Tenant managers configure the heading in General settings. An unset heading uses the UI locale's default greeting.
- A tenant optionally stores a description with 1 through 280 non-whitespace characters. Tenant managers configure the description in General settings.
- The tenant cookbook root front page returns the configured number of featured recipes per page. Its deterministic shuffled order uses a seed stored in the authenticated server session. A root-page refresh renews that seed; subsequent front-page requests use the stored seed. Front-page pagination is client-session state and does not alter the browser URL.
- The root cookbook navigation label is `Featured`. Without a recipe filter, the root list renders the paginated featured front page. With a non-empty recipe filter, the root list renders all accessible discoverable matching recipes regardless of featured state.
- Category recipe lists display 100 recipes per page. Cookbook recipe filters and recipe-link searches normalize Unicode accents and transliterations to ASCII, treat non-alphanumeric ASCII characters as word separators, and rank exact normalized title matches, title phrase matches, title token matches, summary phrase matches, and summary token matches in that order.
- Tenant recipe management lists published recipes in pages of 100. Its filter uses normalized recipe search and uses alphabetical title ordering within each match-rank group.
- The cookbook overview exposes category and recipe public identifiers, slugs, titles, summaries, category assignments, and category parent public identifiers. Both recipe lists and featured front-page lists include visible variants and the default variant from the published revision, ordered by name and variant key.
- Recipe cards display up to ten authored non-default variant names as wrapping labels before the description, prefixed by a localized “Variants:” label. Each vegan or vegetarian variant label includes its green Font Awesome leaf or egg symbol, with a localized tooltip and accessible diet name. The default variant is omitted. Cards without non-default variants omit the entire row. Additional non-default variants are represented by one localized `+{count} more` label.
- The cookbook overview exposes `canCreateRecipes` for the tenant `recipe:create` permission. Recipe creation controls and the new-recipe editor route require this capability.
- The recipe-list header displays a localized recipe creation button. Category lists link to `/{tenantSlug}/recipes/new?categoryPublicId={categoryPublicId}` and preselect that tenant category in the new recipe editor. Featured, global search, and other views without a valid tenant category open the editor without a category assignment. Existing recipe assignments come from the loaded draft.
- In development, API startup loads `development-seed.json` after bootstrap administration and then loads the optional `development-content-seed.json`.
- The development seed defines `user@local` with password `user` and assigns it the `Owner` tenant role for `local-cookbook` without an instance role.
- The development seed defines `guest@local` with password `guest` as a `Viewer` member of `local-cookbook` without instance role assignments.
- The API process runs the tracked `initial-deployment-units-v1` seed once for each database after migrations and before bootstrap administration. The seed inserts instance-owned recipe units from `initial-deployment-seed.json` and records its identifier in `application_seed` in the same transaction.
- Tenant recipe visibility defaults to `PUBLIC`; recipes can inherit or override tenant visibility and discoverability defaults.
- Categories support parent-child trees with no fixed database depth limit.
- A category slug is unique within its tenant. A recipe slug is unique within its tenant.
- Cookbook navigation is deep-linkable: category pages use `/{category-slug}/{sub-category-slug...}` and recipe pages use `/{category-slug}/{sub-category-slug...}/recipes/{recipe-slug}`. A non-default visible variant appends `/{variant-slug}`. A recipe opened from the root cookbook view uses `/recipes/{recipe-slug}`; a recipe opened from a category view uses that category path.
- Hydrated cookbook category, recipe, breadcrumb, and tenant-management navigation use anchor elements with their deep-link URLs. Standard primary-click category navigation updates the URL and selected cookbook state without replacing the hydrated cookbook tree; modified clicks retain native anchor behavior.
- On mobile cookbook overview and category pages, the category tree is provided through a left-side drawer opened from the global header area. The drawer has a fixed control area and a separately scrollable category list.
- The category and recipe slug reservation list is `admin`, `api`, `assets`, `auth`, `health`, `login`, `logout`, `recipes`, and `settings`. The database rejects these values for both entity types.
- `/login` is the public sign-in route. An unauthenticated request to it renders the sign-in form; an authenticated request redirects to `/`.
- `/` presents the accessible tenant selection. Cookbook content is loaded only after choosing a tenant at `/tenants/{tenant-slug}`; a cookbook response contains records from exactly one tenant.
- The instance root page stores a website name, slogan, and cookbook page size from 1 through 100. Defaults are `My Cookbook`, `Made to be shared`, and 4. Instance administrators configure these values in Front page settings.
- The instance stores public privacy-statement and legal-notice Markdown documents. The initial database creates editable English template documents with operator placeholders. Instance administrators edit both documents in Legal documents settings. Public `/privacy-statement` and `/imprint` pages render their Markdown with source HTML disabled.
- The footer links the license and the displayed application version to the Shadowcook GitHub repository at the build commit.
- A cookbook has a `show_on_start_page` setting that defaults to `true` and is configurable through General settings.
- The root page lists accessible enabled cookbooks with `show_on_start_page = true`, with a case-insensitive contains filter over cookbook names and descriptions. Results use a client-provided stable shuffle seed and paginate using the configured cookbook page size.
- Above the root-page cookbook selection, authenticated users receive an alphabetical `My Cookbooks` list of every enabled cookbook where they have a tenant membership. The list does not apply root-page or recipe visibility filters.
- The root page website name and slogan use the tenant cookbook header's eyebrow and heading presentation dimensions.
- Successful sign-in and sign-out navigate to `/` as full page transitions.
- A sticky global head bar is rendered on application, public cookbook, and public recipe pages. The Astro server resolves the current session before rendering it; the hydrated client validates that state after load. It provides sign-in for unauthenticated visitors, and provides administration actions only to authorized users and sign-out actions to authenticated users.
- The head bar displays the application logo, a locale-resolved wordmark at viewport widths above 700 pixels, and control icons. Registration, sign-in, language, and user controls have locale-resolved accessible names and tooltips. The user dropdown begins with the account display name and email address, followed by account settings, authorized administration, and sign-out actions. Dropdowns close on outside pointer interaction or Escape; Escape restores focus to the dropdown control.
- `GET /auth/session` returns `email`, `displayName`, `hasPassword`, and `passwordChangeRequired`. The display name is read from the current user account.
- Protected tenant-management and instance-administration pages server-resolve their access state before rendering. Client-side validation does not introduce a session-check loading screen.
- Tenant-management pages use the two-column navigation layout only when the user has cookbook-management access. Access-denied panels render without a reserved navigation column.
- A tenant has an optional description. The tenant-selection response includes the number of published recipes for each accessible tenant.
- The Astro web application uses server rendering so category and recipe navigation paths are directly addressable. It proxies browser API requests with the `/api` prefix to `SHADOWCOOK_API_ORIGIN`, which defaults to `http://localhost:3000`; it forwards API redirects without following them and requests uncompressed upstream API responses. At image build time, `PUBLIC_WEB_ORIGIN` configures Astro's allowed forwarded domain for SSR origin checks.
- Public cookbook overview and category navigation paths render their accessible category and recipe links as semantic server-rendered HTML without a client-side session check.
- Public cookbook overview, category, and recipe pages server-render the same cookbook component with server-resolved data; JavaScript-capable browsers hydrate that component without replacing it.
- A direct recipe navigation renders its title, summary, category links, selected visible variant links, ingredient usages, and preparation steps as semantic server-rendered HTML. The server forwards the request cookie when resolving recipe access.
- Server-rendered recipe pages render the `CookbookScreen` with the resolved cookbook, category, and recipe state. JavaScript-capable browsers hydrate that same `CookbookScreen`; clients that do not execute JavaScript retain its server-rendered recipe content.
- Server-rendered recipe pages include a canonical URL and a Schema.org `Recipe` JSON-LD document with the recipe URL, tenant author, title, optional summary, category names, non-special ingredient usages, and ordered preparation steps.
- Sibling categories have a non-negative tenant-scoped `sort_order` that is unique within their parent category.
- Every published recipe revision has at least one category. Draft revisions may be uncategorized.
- The tenant-scoped category editor is available at `/{tenant-slug}/categories`. It requires `category:update` and creates, updates, reparents, and deletes categories through `/cookbook/tenants/{tenantSlug}/categories`.
- Category management displays a full-width category list. Category rows highlight across their full width on hover and while an action button has focus. Category creation, child-category creation, and editing open the form in the shared application dialog with initial name-field focus. Save errors appear inside the dialog. Saving disables form controls, actions, and Escape dismissal. Successful saves close the dialog and refresh the categories; cancellation discards the form. List messages appear outside the dialog.
- `/{tenant-slug}/manage` is the deep-linkable cookbook-management entry route. It displays the tenant management navigation and an empty management-area placeholder until a concrete management route is selected.
- The category editor changes a category's sibling order only by moving it one position up or down. The operation swaps `sort_order` with the adjacent category under the same parent.
- A category deletion is rejected when the category or any of its descendants is assigned to a recipe revision. Category slugs reserve `categories` in addition to the other cookbook route segments.
- Editable category responses expose whether a category tree can be deleted, based on recipe-revision assignments in that category and all descendants.
- A future draft view will list recipes with an active draft revision separately from published cookbook navigation.
- `GET /cookbook/recipes/{publicId}` returns one accessible published recipe with ordered preparation steps and the ingredient usages assigned to each step.
- Recipe and shared-recipe detail views provide an icon-only PDF download button beside the ellipsis action menu, with a localized tooltip and accessible name. The browser generates an A4 PDF with pdfmake from the already resolved published recipe and selected variant. The PDF contains the title, optional summary and non-default variant name, aggregated shopping list, step ingredients beside preparation instructions, recipe-reference links, automatic page breaks, and localized page numbers. UI labels and unit symbols use the active UI locale; authored content retains its stored language. Roboto fonts are embedded. PDF code and font data load on demand. Vite explicitly pre-bundles the pdfmake browser build and virtual font filesystem during development. PDF download failures retain the original exception in the browser console with a UTC timestamp and display the localized error dialog. The export uses existing recipe-read authorization and adds no API route or persistent data.
- Special recipe entries use one shared Font Awesome icon mapping in the recipe view and PDF export. PDFs embed the package-provided icon paths as SVG vectors beside authored notes. `NO_ICON` entries render only their authored notes, without an icon or type label.
- Recipe PDF front matter contains a dedicated cover with the recipe title, creator display name when available, selected non-default variant, description, and shopping list. The cover displays the recipe image when available and a neutral image area otherwise. Shopping lists use one column for up to 12 items, two columns for 13 through 30, and three columns for more than 30. Large front-matter content flows onto additional pages without truncation. Preparation steps begin on a new page after the front matter.
- Recipe PDF pagination treats each preparation step's ingredient and instruction cells as one unit. A step spanning pages after another step begins with both cells on a fresh page. Steps already starting on a fresh preparation page remain breakable when their content exceeds the available page area. Pagination uses rendered positions from both tagged cells, including steps without ingredients and ingredient-heavy steps. Preparation column headings repeat across page breaks. The preparation table draws horizontal rules below its column headings and completed steps, without an upper table border or rules at page breaks inside a row. No step content is truncated.
- Recipe PDFs embed the existing `/shadowcook-logo.png` application asset and the locale-resolved application wordmark. The recipe title is the large bold primary header text, with the smaller muted cookbook name below it; a smaller muted wordmark and compact logo appear on the right. Following pages add a fine horizontal separator. Page content reserves space below the repeating header. The browser loads and embeds the logo when creating the PDF; the downloaded file has no external logo dependency.
- Recipe PDF covers display the full cookbook name as a prominent heading above the recipe title, with the published recipe version below the title. Document subjects include the full cookbook display name and published version. Every PDF header includes the cookbook name, recipe title, and published version beside the secondary application branding. Header names normalize whitespace and use an ellipsis when shortened to a single line within their fixed column width; the cover retains complete names. Recipe-detail and shared-recipe responses supply required `cookbook_name` and `version` fields from the owning tenant and published revision. Drafts do not change the exported version.
- Recipe PDFs include a localized online-recipe label and a visible clickable absolute URL after contributor credits and before recipe details. The URL uses the current origin and the root cookbook recipe route, including the selected non-default variant slug. The link is also included when contributor lists are empty. PDF exports from shared views use the same canonical recipe route without embedding a share token. Source links are omitted when the PDF builder has no origin and cookbook-slug context. Existing recipe-read authorization applies to the linked page.
- Published and shared recipe-detail responses include nullable `creator_display_name`. It resolves the earliest recipe revision's principal to the current user display name or service-account name. It exposes no account identifier or authentication data. Missing creator principals produce `null`.
- `recipe_revision_contributor` stores normalized revision-to-principal memberships with a composite primary key and cascading revision deletion. Existing revision creators are backfilled. Successful recipe creation and draft title, summary, category, step, ingredient, variant, and variant-membership writes record the authenticated principal in the same transaction. Existing drafts retain every recorded editor. Copied drafts start with the new draft creator's contribution; prior revisions retain their contributions. Failed writes roll back contribution records. Visibility changes, publication, sharing, and draft discard do not add contributions.
- Published and shared recipe details return `contributors` with current user display names or service-account names. The list combines revision creators and recorded editors from published and archived revisions, deduplicates by principal, and orders by earliest contributed revision and display name. Draft-only contributions are excluded. Discarded drafts remove their contribution memberships. Names from previously unrecorded edits cannot be recovered.
- Recipe views and PDFs display a compact localized contributors section after preparation instructions. Empty lists omit the section. Contributor responses expose no principal IDs, account IDs, email addresses, or authentication data. Cookbook ZIP exports include per-revision contributor display names, including drafts; development-content seed exports preserve contribution memberships.
- Recipe variants store nullable `difficulty` (`EASY`, `MEDIUM`, `DEMANDING`), `total_minutes`, `active_minutes`, `kcal`, `servings`, and `utensils` columns. Duration values are whole minutes from 0 to 5,256,000. Calories are finite numbers from 0 to 1,000,000,000. Servings are finite numbers greater than 0 and at most 1,000,000. Active duration cannot exceed total duration when both are supplied. Utensils are authored free text of at most 4,000 characters; blank input becomes null. There is no utensils catalogue.
- Recipe variants store one nullable `diet` classification: `VEGAN`, `VEGETARIAN`, or `OMNI`. Null is unclassified. `GET /cookbook` accepts a `diet` filter: vegan matches vegan, vegetarian matches vegetarian and vegan, and omni matches all three explicit classifications. Recipes match a diet filter when at least one published visible variant matches. Hidden variants do not participate. Unclassified variants match only an absent diet filter. Diet and text filters apply together to recipe results, featured results, and featured counts. Browser diet selections use the `diet` URL query parameter and support direct navigation and browser history. MCP recipe search accepts the same optional diet and text filters.
- Cookbook, featured, and managed recipe summaries include the published default variant's nullable `diet`. Recipe cards and regular and shared recipe detail views display a green Font Awesome leaf for `VEGAN` and a green Font Awesome egg for `VEGETARIAN` beside the title. Icon-only cards have localized tooltips and accessible names. Detail views display the localized diet name as normal HTML text beside a decorative symbol, with independent font sizing and normal letter spacing. PDF covers display the matching green symbol and localized text below the recipe title. Web and PDF output share the diet-to-icon mapping. `OMNI` and unclassified recipes omit the symbol and label.
- Variant creation and update accept optional `metadata` and `diet` fields. Legacy recipe creation and draft writes apply these fields to the default variant only. Top-level response fields project the selected variant in recipe details and the default variant in draft, revision, shared, AI, and export responses. Variant responses and exports expose their own `metadata` and `diet`. New variants copy preparation metadata and diet from the current default variant. Explicitly supplied creation fields override the copied values. The create dialog starts with these copied values. Subsequent edits are independent. Metadata objects contain camel-case `difficulty`, `totalMinutes`, `activeMinutes`, `kcal`, `servings`, and `utensils` fields. A supplied metadata object replaces all six values; omitted object members become null. Omitting metadata or diet from a draft write preserves existing values. Draft copying preserves all metadata and the explicit diet. Publication, archival, revision snapshots, AI readers, cookbook ZIP exports, and development-content seed exports preserve these variant values.
- Recipe detail, shared detail, draft, and revision snapshot responses expose read-only UTC `createdAt` and `updatedAt`. Creation uses the original recipe creation timestamp. Published and historical views use the displayed revision's publication timestamp for the last change. Editor responses use the current published revision's timestamp, or null before first publication. Draft edits and immediate policy changes do not advance the displayed last-change timestamp.
- Recipe and shared views and PDFs end with a localized recipe-details block after contributor credits and PDF source links. Only supplied values appear. Calories per serving are calculated from total kcal and positive servings only; incomplete data is valid and omits the derived value. Derived calories are neither persisted nor editable. Numbers display up to two fractional digits without trailing zeroes. Durations display hours and minutes. UI timestamps use localized date and time formatting. The variant editor has optional difficulty and diet selections, duration inputs in hours and minutes, calorie and serving inputs, a free-text utensils field, calculated calorie output, and read-only timestamps. The variant create/edit dialog maintains preparation metadata for that variant. The recipe editor maintains title, summary, categories, policy settings, URL name, and read-only timestamps. Migration copies existing revision preparation metadata into every variant and removes the preparation columns from recipe revisions.
- The recipe-step editor can append a step and insert a step directly after every existing step.
- Recipe-editor save, publish, discard, and share actions appear above the active editor content in a sticky action bar below the site header. A resize observer updates the bar's offset when the header height changes. The bar gains a border and shadow when its original position scrolls above that offset. Draft saving submits its associated form; the step editor renders its save action into the bar through a React portal. Step saving blocks publication and draft discard until the request completes.
- Recipe editors with a published revision display a localized "Back to Recipe" link in the action bar. It opens `/{tenantSlug}/recipes/{recipeSlug}` using the saved recipe slug and becomes available after the first publication. Draft-only recipes omit the link. Mobile layouts show a Font Awesome left chevron with a localized accessible name and tooltip.
- At viewport widths up to 700px, the recipe-editor action bar stays on one line with compact spacing. Draft and step saving use a Font Awesome floppy-disk icon; draft discard uses a trash-can icon. These buttons retain localized accessible names and tooltips. Publication keeps its localized action label during requests and exposes its busy state through `aria-busy`. Wider viewports retain save and discard text labels.
- Recipe-step instructions support `{recipe:<recipe-public-UUID>}` references. Recipe details resolve accessible referenced recipes to root cookbook URLs. The recipe editor inserts this syntax through an `@` recipe search that returns at most one hundred current-tenant recipes.
- Newly appended and inserted recipe steps receive client-generated UUIDv4 identifiers from `crypto.getRandomValues()`. Step creation works on HTTP LAN origins without `crypto.randomUUID()`.
- `GET /cookbook/tenants/{tenantSlug}/recipes/slug-availability` requires `recipe:create` or `recipe:update` and checks all tenant recipes, including draft-only recipes. It accepts a required `slug` and optional `excludePublicId`, returns only `{ available: boolean }`, and disables response caching. Recipe creation and metadata writes retain database-enforced slug uniqueness and return `RECIPE_CONFLICT` on collisions.
- Recipe URL-name inputs check availability after 250ms without input changes. Superseded requests are cancelled and ignored. The current recipe's unchanged slug remains valid. Localized field feedback identifies invalid, occupied, checking, and failed-check states. Known conflicts and pending checks block recipe creation and metadata saving; draft-content saving remains independent of metadata validation.
- Failed recipe-draft, metadata, step, and variant writes display the shared `MessageDialog` error dialog. UI locale messages resolve API error codes for URL conflicts, invalid input, missing records, authentication, permissions, network failures, and server failures. Unknown API codes with an uppercase identifier format appear in a localized error message. API response text and stack traces are not rendered. Successful saves retain inline status messages and failed writes retain form input.
- The web client separates cookbook orchestration, cookbook dashboard rendering, category tree rendering, public tenant selection, tenant management, sign-in, password change, status messages, and browser API requests into dedicated components or modules.
- `apps/web/src/features/cookbook` contains cookbook orchestration, cookbook UI components, routing, and cookbook model types. `apps/web/src/features/admin` contains instance-administration orchestration and UI components. `apps/web/src/lib` contains shared browser-session and API-request infrastructure.

### 4.3 Development database reset

- `pnpm reset:shadowcook-db` drops and recreates the PostgreSQL `public` schema in the `shadowcook` database only when `NODE_ENV=development`.
- `pnpm reset:dev-db` remains an alias for the development database reset.
- The next API startup applies the current initial schema, bootstrap administration, and development seeds.
- The local `development-seed.json` stores development accounts, tenant configuration, roles, memberships, SMTP configuration, and units. It does not store ingredients, categories, or recipes.
- The optional local `development-content-seed.json` stores tenant categories, recipes, revisions, variants, steps, ingredient usages, and the ingredients, aliases, and units required by those usages. It is loaded after `development-seed.json`.
- `pnpm export:development-content-seed` reads the tenant selected by `TARGET_DB_TENANT_SLUG` from `.env.migration` and validates the optional content seed. `pnpm export:development-content-seed --execute` writes the file at `DEVELOPMENT_CONTENT_SEED_PATH` or `development-content-seed.json`.
- `pnpm export:ingredient-cleanup-csv --execute` writes every catalogued ingredient in `development-content-seed.json` to `ingredient-cleanup.csv` with the columns `Zutat`, `Neuer Zutat-Name`, `Zusaetzlicher Modifier`, and `Alias`. `pnpm ingest:ingredient-cleanup-csv --execute` resolves ingredient and alias names case-insensitively, merges a new name that already identifies a catalogued ingredient, resolves subsequent alias targets for merged ingredients, appends non-empty modifiers to matching ingredient-usage notes, creates resulting ingredient aliases, and atomically updates the content seed. The optional `INGREDIENT_CLEANUP_CSV_PATH` and `DEVELOPMENT_CONTENT_SEED_PATH` variables select paths relative to the repository root.
- The repository-root `initial-deployment-seed.json` is versioned deployment data. An initial-deployment seed is applied once and is not reapplied after an administrator changes or deletes seeded records.

### 4.4 Instance mail delivery

- SMTP settings are instance-wide and are available only to principals with `instance:mail-manage` or `instance:administer`.
- SMTP passwords are encrypted using AES-256-GCM with the base64-encoded 32-byte `INSTANCE_SECRET_KEY` supplied to the API process.
- The API does not return stored SMTP passwords.

### 4.5 Public self-service registration

- Public registration is controlled by the instance-administration registration setting and defaults to enabled.
- Public registration requires first name, last name, and display name. Each name is trimmed and contains 1 through 120 characters. Pending registrations store these names and verification transfers them to `user_account`.
- `user_account.first_name` and `user_account.last_name` are nullable for existing accounts, bootstrap accounts, and seeded accounts. Pending registrations created before name fields were introduced retain verification support and their email-derived display-name fallback.
- Authenticated accounts read their names through `GET /account/profile` and update all three names through `PUT /account/profile`. Profile updates require all three names and update only the authenticated account.
- The deep-linkable `/settings` page contains a localized profile form for first name, last name, and display name. Saving immediately updates the display name in the site header.
- Account settings provide separate localized navigation entries for personal data at `/settings/profile`, email address at `/settings/email`, and owned cookbooks at `/settings/cookbooks`. `/settings` displays personal data.
- Account settings use a two-column layout with a sticky left navigation and a content panel. Navigation shares the instance-administration sidebar styles, including the green active item. At viewport widths of 760 pixels or less, navigation appears above the content in two columns. Password settings retain the active personal-data navigation item. Public email-change confirmation pages use the authentication layout.
- Personal data settings include a localized Change password action linking to `/settings/password`. The password form requires the current password for accounts with a password and a new password. Accounts without a password supply only a new password. The form uses the shared password fields with visibility controls and the configured entropy indicator and submits to `POST /auth/change-password`. Successful account-settings changes clear both fields and replace the form with a localized confirmation view. The return action uses the standard button-link style and receives keyboard focus after success. Failed changes retain the form and display localized feedback. The account-settings and required-password-change screens share `PasswordChangeForm`.
- Authenticated accounts request an email address change through `POST /account/email-change` and resend through `POST /account/email-change/resend`. `GET /account/email-change` returns the current address, unexpired pending address, link expiration, next permitted send time, and server time in UTC.
- `account_email_change` stores at most one pending change per account, with the normalized target address, a unique SHA-256 hash of a cryptographically random 32-byte token, expiration, last successful send time, and send count. Account identity, principal, and memberships remain unchanged.
- Email change links use `/settings/email/verify/{token}`, expire 24 hours after sending, and require an explicit confirmation action through authenticated `POST /account/email-change/verify`. Each successful send replaces the previous token. Expired, replaced, and consumed links cannot update an account. Unconfirmed changes have no effect on the current email address; no cancellation operation is provided.
- `POST /account/email-change/verification` accepts a token in the request body and returns the current email, proposed email, expiration, and reauthentication requirement only to an active session of the requesting account. It does not consume the link. Confirmation validates the same account association inside the update transaction and requires a session created by authentication within the last five minutes. Session creation through configured password or email-code authentication provides this authentication timestamp. Missing, expired, revoked, or mismatched sessions and stale authentication cannot consume or extend a link. Accounts with a required password change must complete it before confirmation.
- Email-change confirmation pages display sign-in with the existing email address when unauthenticated, explicit sign-out and account switching for a mismatched account, and sign-in again for stale authentication. `/login?reauth=1&next=...` renders the existing login flow even when a session already exists and returns to the confirmation link after password or email-code authentication. Account switching revokes only the currently active browser session after the user selects the switch action. Confirmation remains an explicit user action after authentication.
- Email change sends enforce per-account waiting periods of 1, 3, 10, 30, and then 60 minutes. UI buttons display a countdown using the server time and disable sending during the wait. The backend serializes sends with an account row lock, returns `429` with `Retry-After`, and enforces the same wait when the requested address changes. The send count resets after 24 hours without a successful send.
- Email change SMTP failures roll back pending change updates. Successful confirmation atomically checks email availability, updates the account email, removes the pending change, and consumes outstanding password-reset tokens and login email codes for the old address. Disabled and deleted accounts cannot confirm changes. Active sessions remain valid.
- The configurable `EMAIL_CHANGE_VERIFICATION` system email template includes recipient name, recipient email, instance name, action URL, and link lifetime placeholders.
- The API creates `pending_registration` records before email verification; these records store a password hash and a SHA-256 verification-token hash, never plaintext credentials or verification tokens.
- Pending registrations expire after the configured `SHADOWCOOK_REGISTRATION_PENDING_LIFETIME`, defaulting to 24 hours. API-process cleanup runs every three hours.
- `POST /registration` applies configurable IP limits, validates an empty honeypot and a Cloudflare Turnstile token, and sends the email-verification URL.
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, and `TURNSTILE_SECRET_FILE` are optional deployment environment settings. The API exposes only a configured `TURNSTILE_SITE_KEY` through the public registration configuration endpoint.
- Instance administrators can require Turnstile only when both the site key and secret are configured. When Turnstile is not required, registration accepts no Turnstile token.
- `POST /registration/verify` deletes an unexpired matching pending registration and creates the user in one transaction. A pending registration with a cookbook name additionally creates the tenant, initial Owner, Editor, and Viewer roles, membership, and owner-role membership in that transaction.
- Registration verification rejects an active session for another email address with `REGISTRATION_ACCOUNT_MISMATCH` and rolls back token consumption. The confirmation page offers an explicit sign-out action that returns to the same link. Successful registration links to `/login?reauth=1&next=%2F`, which renders the login form even when another browser session exists.
- Public registration presents the mutually exclusive choices to create a cookbook now or later. The later choice stores no cookbook name and verification creates only the account.
- Authenticated accounts create an owned cookbook through `POST /account/cookbooks` and the deep-linkable `/settings` account-settings page. The created cookbook has the initial Owner, Editor, and Viewer roles, and the creating account receives the Owner membership.
- `GET /account/cookbook-slug-preview` returns the normalized cookbook URL slug and its current availability. Cookbook-name forms show the resulting read-only URL and a collision warning.
- The hardcoded cookbook-slug dictionary reserves `account`, `admin`, `api`, `assets`, `auth`, `health`, `imprint`, `login`, `logout`, `privacy`, `recipes`, `register`, `registration`, and `settings`.
- Cookbook names are trimmed before storage, contain at most 120 trimmed characters, start with an ASCII letter or digit, and contain at least three ASCII letters or digits. A slug collision is resolved during cookbook creation with a random suffix.
- A cookbook has at most one owner, stored as `tenant.owner_principal_id`. Owner accounts receive the Owner role; tenant user management permits only Editor and Viewer role assignments for other users.
- Instance registration settings store an administrator-configured maximum of 1 through 100 owned cookbooks per account, defaulting to 1. Reducing the maximum preserves existing owned cookbooks. Accounts at or above the maximum cannot create further cookbooks until their owned-cookbook count is below the maximum. Account settings display the owned-cookbook count against that maximum, provide a localized add-cookbook dialog below the limit, and hide cookbook creation once the limit is reached.
- Account settings display owned cookbooks in a table with their recipe and member counts and start-page visibility. An empty table displays a localized no-cookbooks message.
- `POST /registration/resend-verification` has a configurable email-address limit and returns a generic acknowledgement for every input.
- Registration rate events are retained for 25 hours. Default registration limits are five requests per 15 minutes and twenty requests per 24 hours per IP. The default resend limit is three emails per address per hour.
- SMTP transport supports STARTTLS and implicit TLS and can send a test message through the stored configuration.
- Instance administrators with `instance:mail-manage` or `instance:administer` manage system email templates at `/admin/settings/email-templates`.
- `instance_email_template` stores customized subject and plain-text body overrides by system email type. Missing overrides use built-in defaults.
- The system email types are registration verification, email-change verification, sign-in code, user password reset, administrator-required password reset, instance-user invitation, cookbook-user invitation, and cookbook-owner invitation.
- A template accepts only the placeholders defined for its system email type. Placeholder replacement occurs in the API immediately before SMTP delivery.
- System email templates provide `recipient_name`; the API uses the active recipient account display name or the recipient email address when no account exists.
- Cookbook invitation templates can use the inviter name, cookbook name, cookbook URL, invitation URL, code, and expiry placeholders.

### 4.5 Docker-first runtime configuration

- `SHADOWCOOK_API_TRUSTED_PROXIES` and `SHADOWCOOK_WEB_TRUSTED_PROXIES` accept comma-separated proxy IP addresses, CIDRs, or the `loopback`, `linklocal`, and `uniquelocal` ranges. Unset values trust no forwarded IP headers. Compose defaults to `loopback,uniquelocal` for the private application network and host reverse proxy.
- The web runtime starts through `apps/web/server.ts`, sanitizes forwarded client-IP headers using the socket peer and configured trusted proxy chain from right to left, and calls the built Astro handler. It supplies a single resolved IP to the API through `X-Forwarded-For`; alternative `Forwarded` and `X-Real-IP` headers are removed. The development Vite API proxy applies the same sanitization. The API resolves forwarded IPs only from configured trusted peers.
- The bundled Apache reverse-proxy example removes incoming client-IP forwarding headers before Apache appends the observed visitor IP. The web listener remains bound to loopback by default. Deployments with untrusted private peers configure narrower proxy addresses or CIDRs.
- A deployed Shadowcook instance runs as containers. The API process is configured through container environment variables and Docker Secrets.
- A repository-root `.env` file is only a local-development convenience and is not required by a container deployment.
- The operator-facing Docker Compose package is in `deployments/package`. Its `.env` selects the Git repository URL and stores the full build commit used as the Docker build context and displayed in the web footer.
- `COMPOSE_PROJECT_NAME` in the deployment `.env` selects the instance's Compose project. The default project name remains `shadowcook`. Container, network, and bundled PostgreSQL volume names are scoped to that project.
- Both Compose variants explicitly name the API and web containers `${COMPOSE_PROJECT_NAME}-api` and `${COMPOSE_PROJECT_NAME}-web`. Bundled PostgreSQL uses `${COMPOSE_PROJECT_NAME}-postgres`. Container names have no numeric suffix; each service runs as one container per project. Network and volume naming remains scoped to the Compose project.
- Each instance has a separate deployment directory, `.env`, instance secret, and non-overlapping host listener addresses and ports. External PostgreSQL instances use separate databases.
- Application image names are `shadowcook-api:<tag>` and `shadowcook-web:<tag>`. `SHADOWCOOK_IMAGE_TAG` selects the tag; its Compose fallback remains `local`. The deployment `.env.example` sets the tag to `${COMPOSE_PROJECT_NAME}`. Separate instances use separate application image tags.
- `deployments/package/upgrade.sh` accepts a branch, tag, or commit hash, fetches and resolves it to a full commit hash, stores that hash in `SHADOWCOOK_SOURCE_REF` and `SHADOWCOOK_BUILD_COMMIT`, and passes it together with `SHADOWCOOK_BUILD_PROJECT` and `PUBLIC_WEB_ORIGIN` explicitly to the Docker Compose build before recreating the containers without a second build.
- The build-stage, API runtime, and web runtime images carry the Docker image label `net.shadowcook.deployment=true`.
- Both Compose variants apply the image build label `net.shadowcook.project=<resolved-project-name>` to API and web runtime images.
- Both Compose variants pass the resolved project name as the `SHADOWCOOK_BUILD_PROJECT` Docker build argument. Every Dockerfile stage declares this argument and sets `net.shadowcook.project` before dependency installation, compilation, and runtime assembly. Classic-builder intermediate images inherit the project label. Builds use the Dockerfile from the selected Git ref.
- `deployments/package/upgrade.sh` resolves project and application image names through Compose, rejects existing image tags labelled for a different project before building, and verifies deployment and project labels on both built runtime images before container recreation.
- `deployments/package/upgrade.sh` runs `docker image prune --all --force` filtered by `net.shadowcook.project=<resolved-project-name>` after a successful container recreation. The cleanup includes unused runtime and classic-builder intermediate images for that project. Other projects' images, shared base images, and legacy images without the project label are retained. BuildKit's separate build cache is not pruned.
- Both Docker Compose deployment variants use `pull_policy: never` for the API and web images. Normal `docker compose up -d` reuses existing local application images; missing application images are built from the selected Git ref.
- `docker compose up -d` reads the deployment `.env` and recreates containers with changed runtime configuration. `docker compose start` and `docker compose restart` retain the existing container environment.
- Commit changes are built explicitly through `deployments/package/upgrade.sh <git-ref>` or `docker compose build`. Changing the configured Git ref or build commit alone does not rebuild an existing image during normal startup.
- Application image builds compile the database package, API, and Astro web application. `SHADOWCOOK_BUILD_COMMIT` and `PUBLIC_WEB_ORIGIN` are passed as Docker build arguments; the commit is compiled into the web footer and the public origin configures Astro's allowed forwarded domain. Changes to `PUBLIC_WEB_ORIGIN` require an image build.
- The Dockerfile has one build stage and separate API and web runtime targets. The runtime targets contain compiled application output and production dependencies.
- `deployments/package/compose.yaml` starts API, web, and a persistent bundled PostgreSQL service. `deployments/package/compose.external-postgres.yaml` starts API and web only and requires `DATABASE_URL` for an existing PostgreSQL service.
- `deployments/package/compose.yaml` derives the API database connection URL from the bundled PostgreSQL service credentials. `deployments/package/compose.external-postgres.yaml` passes the explicit `DATABASE_URL` deployment value to the API process.
- Both Docker Compose deployment variants pass optional `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` values from the deployment `.env` file to the API process.
- `pnpm package:deployment` creates a versioned tarball containing the Dockerfile, Apache reverse-proxy example, and operator-facing deployment package files.
- The API waits for the bundled PostgreSQL health check before startup. The web service waits for the API health check before startup.
- Secrets required before the API can access PostgreSQL data remain outside the database. `INSTANCE_SECRET_KEY` is supplied as a base64-encoded 32-byte value or as the path named by `INSTANCE_SECRET_KEY_FILE`.
- Docker deployments provide `INSTANCE_SECRET_KEY_FILE=/run/secrets/instance_secret_key` and mount the secret at that path.
- Database connection configuration and operational encryption keys are deployment configuration. SMTP server details, SMTP credentials, sender identity, and other settings an instance administrator can change at runtime are stored in the database and managed through the administration UI.
- Stored operational secrets are encrypted with the instance encryption key and are excluded from portable tenant backups.

### 4.5.1 Operational database backups

- `scripts/backup-database.sh` and `pnpm backup:db` create full PostgreSQL custom-format database dumps. The deployment tarball includes `backup-database.sh`.
- The script reads literal single-line connection values from the selected `.env`, with `DATABASE_URL` taking precedence over bundled PostgreSQL settings.
- Bundled Compose deployments execute `pg_dump` and `pg_restore` inside the running `postgres` service using the selected `.env` and its `COMPOSE_FILE`, defaulting to `compose.yaml`. Dumps stream to the host and archive validation reads through standard input. Backup execution does not start or recreate containers and does not require host PostgreSQL client tools.
- External databases and standalone bundled credentials without a Compose file use host PostgreSQL client tools. Standalone bundled credentials use the published host port.
- Each run creates a private `backups/YYYYmmddTHHMMSSZ` directory using UTC beside the selected `.env`, or under an explicit output directory. Existing timestamp directories are not overwritten.
- Successful backups contain `database.dump`, `SHA256SUMS`, `contents.list`, and diagnostic logs. Archive validation uses `pg_restore --list`. Failed dumps retain the `.partial` suffix.
- Operational database dumps contain database schema, data, and stored encrypted secrets. Instance encryption keys, filesystem media, and PostgreSQL cluster roles are stored separately. Portable tenant archives follow section 27.
- `scripts/restore-database.sh` and `pnpm restore:db` validate a selected completed `database.dump` against its `SHA256SUMS` and archive contents. Database writes require `--execute`.
- Restore uses `pg_restore --clean --if-exists --single-transaction --exit-on-error --no-owner --no-acl` against the database configured by the selected `.env`. Objects represented in the archive are replaced; additional objects outside the archive are retained. Restore failures abort the restore transaction.
- `--create-database` creates a missing database using `POSTGRES_*` credentials before the restore transaction. Database creation is separate from the restore transaction; a failed restore can leave the newly created database empty.
- API and web services are stopped by the operator before restore and started by the operator after success. Restore does not start or stop containers. Restore diagnostics use private UTC timestamp directories under `restore-logs` beside the selected `.env`.
- Backup and restore share dotenv parsing and database-tool execution in `scripts/database-tools.sh`; the deployment package includes all three shell files.

### 4.6 Instance administration

#### Content reports

- Signed-in human users without a required password change submit reports for accessible published recipes, cookbooks, and users through `POST /reports`. Valid unexpired recipe share tokens also authorize recipe reports. Reports require a reason and an authored description of 1 through 5,000 characters. Reasons are `ILLEGAL_CONTENT`, `IMPROPER_NAME`, `HARASSMENT`, `SPAM`, and `OTHER`.
- `GET /reports/users?tenantSlug=...` returns reportable user public identifiers and display names without email addresses. Cookbook members receive fellow members; other authenticated visitors receive owners and published-recipe authors from accessible cookbooks. User reports accept shared cookbook members and accessible cookbook owners or published-recipe authors.
- Recipe pages, shared-recipe pages, and cookbook headers expose report controls inside small Font Awesome ellipsis action menus. Cookbook overview cards have no report control. Recipe action menus contain link copying, permitted editing and sharing actions, and recipe reporting; cookbook action menus contain cookbook-link copying and cookbook reporting.
- User reporting is available in the action menu of a tenant-user management row displaying the user's name. Cookbook headers do not provide a user report action or user selection. Reporting requires an explicitly identified target.
- `ContentActions.tsx` provides the shared action-menu disclosure, outside-click and Escape dismissal, viewport-bounded fixed positioning, and focus restoration after action selection. Copy-link success feedback uses a localized toast; failures use the shared error dialog. Report dialogs use neutral locale-resolved titles and descriptions and the shared application dialog.
- `content_report` stores the reporter account, target type and public identifier, reason, description, status, result, result note, optional assigned administrator account, and UTC creation and update timestamps. Target identifiers remain after target deletion. Target names and links are resolved from current entity records; report descriptions remain authored content.
- New tickets are `OPEN` and unassigned. Statuses are `OPEN`, `UNDER_INVESTIGATION`, and `CLOSED`. A closed ticket requires a result; other statuses require a null result. Results are `BLOCKED`, `UNFOUNDED`, `USER_DELETED`, `COOKBOOK_DELETED`, `RECIPE_DELETED`, and `OTHER`. Result notes accept up to 5,000 characters. Results do not execute blocking or deletion.
- Only instance administrators can list, read, or update tickets and report settings. Administrator assignment accepts an active account holding `instance:administer` or null. Reports are limited to ten per reporting account per rolling hour, with transaction-scoped serialization of rate checks and inserts.
- `/admin/reports` provides a status-filtered dashboard with pages of 50 tickets. `/admin/reports/{publicId}` is the ticket detail URL. `GET /admin/reports`, `GET /admin/reports/{publicId}`, and `PUT /admin/reports/{publicId}` expose ticket administration.
- User report targets link to `/admin/users#user-{publicId}`. The matching user row is scrolled into view and highlighted after the user list loads.
- `/admin/settings/reports` and `GET`/`PUT /admin/report-settings` configure one optional recipient email address in `instance_report_settings`. A null address suspends notification delivery. Pending notifications use the current recipient address and instance SMTP configuration.
- Ticket creation and its `content_report_notification` record commit in one transaction. Notification delivery is attempted immediately after commit. API-process polling runs every minute and retries unsuccessful attempts after five minutes. Workers lock pending rows with `FOR UPDATE SKIP LOCKED`; delivery records attempts and a UTC sent timestamp. Notification delivery is at least once; an interruption after SMTP acceptance and before database commit can cause duplicate mail.
- The customizable `CONTENT_REPORT` email template includes the ticket identifier, target type and identifier, reason, authored description, instance name, recipient details, and a ticket-detail link. Ticket creation remains successful when notification delivery fails or SMTP is unavailable.

#### Administration controls

- `/admin` is a reserved, instance-wide web namespace and is not a tenant slug.
- Astro middleware redirects an unauthenticated request for a protected administration or tenant-management route to `/login?next=<requested-path>` before the page is served. After successful login, the web client returns to the validated internal `next` path.
- The instance administration UI has its own navigation and does not use cookbook breadcrumbs.
- `/admin` is the administration dashboard, `/admin/tenants` is tenant management, `/admin/users` is instance and tenant user management, `/admin/settings` is the instance settings overview, `/admin/settings/smtp` manages SMTP delivery, and `/admin/settings/legal-documents` manages public legal-document Markdown.
- `/admin/settings/cookbook-slug-blocked-terms` manages instance-specific blocked terms for cookbook URL slugs.
- Cookbook URL slugs are rejected when they exactly match the hardcoded reserved-slug dictionary or contain an instance-administered blocked term. The checks apply to cookbook URL previews, public-registration cookbook creation, account cookbook creation, and instance-administrator slug changes. Category slugs do not use this policy.
- `/admin/units` manages instance-owned units of measure and provides same-dimension conversion checks.
- Instance and tenant unit creation and editing use `UnitEditorDialog.tsx` with the shared application dialog shell. Save errors appear inside the dialog. Saving disables form controls, actions, and Escape dismissal. Successful saves close the dialog and refresh the unit list; cancellation discards the form.
- Cookbook-manager unit tables and creation dialogs hide conversion information and controls through the `showUnitConversion` flag in `TenantUnitManagement.tsx`. Instance-administrator conversion controls remain visible. Tenant unit conversion APIs and stored conversion data remain available.
- A unit is convertible only when `dimension`, `base_factor`, and `base_offset` are all set. A non-convertible unit has all three fields set to `NULL`.
- Tenant unit creation stores a derived base factor from one explicit equivalence to a visible, non-temperature convertible unit. The derived value is the conversion source of truth.
- A tenant unit referenced by recipe ingredient usages permits name, symbol, and translation changes; changes to its conversion state or conversion values return a conflict. Omitted conversion fields preserve the stored dimension, factor, and offset. Conversion comparisons ignore trailing decimal zeroes.
- The tenant role named `Owner` has every non-instance permission except `tenant:create`.
- Instance authentication uses `PASSWORD_ONLY`, `EMAIL_CODE_ONLY`, or `PASSWORD_OR_EMAIL_CODE`; the default is `PASSWORD_OR_EMAIL_CODE`.
- Email one-time codes are SHA-256 hashed, expire after ten minutes, allow five failed verifications, and are limited per email address and client IP.
- Tenant owners are assigned through a time-limited invitation, verified against the invited email address, and receive a tenant-scoped Owner role on acceptance.
- Creating a cookbook-owner invitation requires only the owner's email address as recipient information. Cookbook name and slug remain cookbook configuration. Legacy `tenant_invitation.first_name` and `tenant_invitation.last_name` values remain stored; new invitations leave both columns null.
- New accounts accepting a cookbook-owner invitation must provide their first name, last name, and display name. `GET /invitations/{token}` returns existing-account state to anonymous callers with null email and cookbook name. A session matching the invited email receives full details; a different active session receives `INVITATION_EMAIL_MISMATCH`. Profile validation precedes email-code consumption.
- Accepting a tenant invitation starts a browser session for the invited account and returns the assigned cookbook slug.
- A newly created tenant-invitation account has no password verifier, requires password completion, and does not require a current-password value.
- Instance authentication settings store a minimum estimated password entropy from 1 through 256 bits. The default is 60 bits. Instance administrators configure the threshold and can test a password against it locally in Authentication settings.
- `GET /auth/password-requirements` exposes the current minimum estimated password entropy for browser-local feedback in every password-assignment form.
- Outside development, password completion requires matching entries and the configured minimum estimated password entropy. The estimate uses zxcvbn-ts with common, English, and German dictionaries and common keyboard graphs. Passwords identified as a wholly random character sequence use their represented character-pool entropy. Specific character types are not required. Development does not enforce password requirements.
- Browser password-entropy indicators debounce password analysis by 200 milliseconds after the last input event.
- Password-entropy analysis examines at most the first 64 characters. Passwords may contain up to 1024 characters and are hashed in full.
- Password-entry fields provide a localized show-or-hide control. Password-change completion does not require a repeated-password field.
- An active session may accept a tenant-owner invitation only when its email address matches the invited email address.
- One-time email and invitation codes are cleared on session, account, and authentication-step changes and are excluded from browser autocomplete.
- The six-field login-code control distributes pasted digits from the active field and uses backspace in an empty field to remove and focus the preceding digit.
- `PUBLIC_WEB_ORIGIN` is the public web origin used to construct invitation URLs.
- Tenant creation is unavailable until instance SMTP configuration and `INSTANCE_SECRET_KEY` are available. `GET /admin/tenants` returns `smtpConfigured` for the tenant-management UI, and `POST /admin/tenants` returns `SMTP_REQUIRED` without creating a tenant when SMTP is unavailable.
- Tenant creation commits only after SMTP delivery of the owner invitation succeeds.
- Public self-service registration derives a normalized tenant slug from a selected cookbook name. It appends a random suffix only when that derived slug already exists.
- An instance administrator can change a tenant display name and slug. Tenant-scoped owners cannot change either value.
- A failed owner-invitation delivery returns `MAIL_DELIVERY_FAILED`, and the tenant-management UI displays a mail-delivery-specific error.
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

Recipes are edited through exactly one mutable draft revision. Creating a recipe creates its first draft. Editing a published recipe copies its published title, summary, and category assignments into a new draft; publishing archives the prior published revision, assigns the next version number, and clears the draft pointer. A published revision has at least one category. Recipe slug, featured state, visibility, and discoverability are immediate recipe-level metadata and do not create a draft or content revision. Recipe visibility is `PRIVATE`, `MEMBERS_ONLY`, or `PUBLIC`; private published recipes may additionally be exposed through stored, opaque, revocable share-link tokens. Recipe detail responses provide session-specific edit and share capabilities for the recipe-detail actions.

An ingredient usage without a special entry kind contains either a normalized ingredient reference or a non-empty text override. Text overrides support non-ingredient recipe entries such as prepared components and oven settings. A special entry kind has no ingredient reference, text override, amount, unit, or optional state and may have a note. Special entry kinds are no icon, remove, add, information, important, cook, cool, heat, wait, and work step. The editor keeps amount, unit, and optional controls visible for every entry. The API ignores these values for special entry kinds.

The recipe editor retrieves at most twenty matching ingredients for a non-empty ingredient search query. The web client delays each ingredient-search request by 300 milliseconds and does not request or render catalogue ingredient results for an empty query.

The recipe editor provides an independent free-text ingredient control. A free-text ingredient stores its name as a text override and its optional note as an ingredient usage note. A normalized ingredient and a special entry store the optional note as an ingredient usage note.

Recipe detail responses identify whether each ingredient usage references a normalized ingredient. Web clients render all non-special ingredient usage names prominently and render their notes as secondary text. Ingredient management can convert a normalized ingredient into free-text recipe entries, which removes its catalogue identity, search availability, and shopping-list aggregation.

Separating an ingredient alias creates an independent ingredient with the alias name. Only ingredient usages that retain that alias identity are reassigned to the independent ingredient.

Ingredient merging requires a client-side confirmation that identifies the source and target ingredients and states that the operation is irreversible.

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
└── note = "soft"
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

Ingredient usages reference an ingredient identity and optionally the selected ingredient alias. Recipe output uses the selected alias when present and otherwise uses the ingredient canonical name. Ingredients are owned by one tenant. Ingredient consolidation reassigns every `IngredientUsage` from a source ingredient to a target ingredient and removes the source ingredient. Alias conversion additionally retains the source canonical name as an alias of the target ingredient and transfers non-conflicting source aliases. Consolidation is limited to ingredients owned by the same tenant.

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
    └── Note
```

This supports the side-by-side Shadowcook UI naturally.

Recipe-step instructions retain authored whitespace and line breaks throughout draft storage, published revisions, and reader rendering.

### 9.4 Usage notes

An IngredientUsage note stores authored preparation and state information as portable free text.

Examples:

- soft,
- melted,
- cubed,
- finely chopped,
- grated,
- room temperature.

Ingredient usage notes are not catalogue entities and are not translated or mapped during federation.

### 9.5 Optional ingredients

`optional` is semantic recipe data and must not be represented as a note string.

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

Unit names and symbols are database content. `unit.name` and `unit.symbol` store the English default version. `unit_translation` stores additional language versions under the composite primary key `(unit_id, locale)` with a cascading unit foreign key. English is not duplicated in `unit_translation`. Language codes use lowercase language tags with optional script and region subtags. Each version stores a name and symbol. Seeded standard units retain a stable `localization_key` as a seed identifier; display does not resolve this key through static UI translations.

Unit API responses, editor catalogues, and recipe ingredient usages include database language versions. Web clients resolve the active UI locale and fall back to the English default version. Unit tables and conversion selectors display the active UI language. Instance and tenant unit dialogs list all stored language versions, including English, with editable name and symbol fields. Additional versions can be added and removed. The English default cannot be removed. Unit data and supplied language versions are written in one transaction. Omitting the `translations` request field preserves existing versions; supplying it replaces all additional versions. Authored recipe content remains unchanged.

Ingredients and their aliases are tenant-authored content. Web clients render their stored names without localization. Recipe ingredient usages continue to reference ingredient identities rather than translated names.

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
├── Conditions
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

New variants copy the current default variant's persisted step memberships, preparation metadata, and diet in the creation transaction. The source is the default variant before any requested default replacement. Subsequent membership edits are independent.

The variant API exposes stable `variant_key` values and recipe-step row IDs.

The step editor refreshes variant metadata after variant changes while retaining unsaved steps and membership selections. Step reads expose stable `stepKey` values for matching published and draft step row IDs. New steps initially include the default variant. Step membership changes are staged until step saving.

`PUT /draft/steps` accepts optional step `id` and `includedVariantKeys` fields. Steps and explicit memberships are saved in one transaction. Explicit memberships require `variant:update` in addition to `recipe:update`. Existing step keys and memberships survive replacement when identified by an ID from the same recipe. New steps without explicit memberships join the default variant. Step row IDs are reloaded after saving.

Published recipe reads resolve the default variant when no `variant` slug is requested. A requested variant slug resolves that published revision's effective step state.

Variant visibility controls whether a non-default variant is offered to recipe readers. It does not affect step membership.

---

## 13. Recipe revisions

### 13.1 Draft vs published state

Each recipe has at most one mutable draft.

Principals with `recipe:update` can discard the active draft through `DELETE /cookbook/tenants/{tenantSlug}/recipes/{publicId}/draft`. The operation locks the recipe and deletes the draft and its dependent content in one transaction. Published and archived revisions and immediate recipe metadata are retained. A recipe without a published revision is deleted together with its draft. The endpoint returns `204` without a response body, or `404` when the recipe or active draft is absent.

The recipe editor and draft list provide a localized discard action with confirmation. After discarding changes to a published recipe, the editor reloads the published content. After discarding a never-published recipe, the editor navigates to the tenant draft list.

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

- title and summary,
- variants,
- steps,
- variant overrides,
- ingredient usages,
- category membership.

Recipe slug, featured state, visibility, and discoverability are recipe/tenant metadata, not recipe-content state. They are not copied into content revisions. Policy changes are auditable separately, and a metadata update does not create a recipe-content revision.

Global catalogue entities such as Ingredient and Unit are referenced rather than cloned into each recipe revision.

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
- A Tenant-Manager can create tenants.
- A Tenant-Manager cannot assign or remove `administrator` or `tenant-manager` roles.
- `Tenant-Owner` is a tenant-scoped role for complete administration of one tenant.
- A Tenant-Owner can manage users, roles, cookbook content, settings, and service accounts only within the tenant in which the role is assigned.
- Tenant-Manager permissions do not make the assignee a Tenant-Owner of any tenant.
- Tenant-user invitations select exactly one tenant role and assign the accepted account to that tenant with the selected role. They support both new accounts and existing accounts that authenticate with the invited email address.

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

unit:read
unit:create
unit:update
unit:delete

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
- `POST /auth/password-reset/verification` validates the recovery token without consuming it and returns its UTC expiration without account details. Password-reset validation and completion support anonymous requests and sessions matching the token's immutable account ID. An active session for another account receives `PASSWORD_RESET_ACCOUNT_MISMATCH`; completion checks this association inside the reset transaction. Rejected requests leave the token, password, and sessions unchanged. Disabled and deleted target accounts cannot reset passwords. Successful completion clears the browser session cookie.
- Password-reset pages check the token before showing the form, offer explicit sign-out and return to the same recovery link for a mismatched session, and replace the form with confirmation and an explicit sign-in action after successful recovery.
- Display names are not unique.
- `user_invitation` stores a SHA-256 verifier of an opaque seven-day invitation token, the invited email address, the creator principal, and acceptance state.
- Instance administrators and cookbook owners identify invited users by email only. New accounts accepting an instance-user or cookbook-user invitation must supply first name, last name, and display name, with 1 through 120 trimmed characters each. Acceptance stores all three names and redirects to `/login?reauth=1&next=%2F`. It requires a password unless the instance login mode is `EMAIL_CODE_ONLY`.
- `GET /user-invitations/{token}` returns password-requirement and existing-account metadata to anonymous callers with a null email. A session matching the invited email receives the email address. GET and acceptance reject any active session for another email address with `INVITATION_EMAIL_MISMATCH`, including invitations for new accounts. Failed acceptance rolls back invitation consumption. Existing-account acceptance also validates the signed-in account ID. Invitation pages offer explicit sign-out and return to the original invitation when a different account is active; existing accounts use the explicit login flow with return to the invitation when unauthenticated.
- Tenant-user invitation acceptance creates a new account when the invited email address has no active account. When an active account exists, acceptance requires a session for the invited email address and adds its principal to the invited tenant membership with the selected role.
- Existing accounts accepting cookbook-user or cookbook-owner invitations retain their stored names and do not submit profile fields. First name, last name, and display name remain editable through `/settings` after account creation.
- `instance_role` is an instance-wide role. The seeded `administrator` role has every registered permission.
- `principal_instance_role` assigns an instance role to a principal.
- `tenant_role` is tenant-scoped. `tenant_membership` associates a principal with a tenant and `tenant_membership_role` assigns its tenant roles.
- `permission` is the canonical permission catalogue. Role-permission relationships are stored in `instance_role_permission` and `tenant_role_permission`.
- Tenant-role names and their permission assignments are tenant data. The initial tenant-role set will be `Owner`, `Editor`, and `Viewer`.
- Instance administrators can list assignable instance roles and replace a user's instance-role assignments through `/admin/users/{publicId}/instance-roles`.
- Tenant members with `tenant:manage` can list only users of their own tenant and replace roles only for existing memberships through `/cookbook/tenant-users`. Instance-wide roles do not grant tenant permissions.
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
- Password-login failures are stored as individual UTC-timestamped events in the normalized `password_login_failure` table, with an IP address and no account reference. Ten failures in a rolling 15-minute window block further password logins from that IP with `LOGIN_RATE_LIMITED` and a `Retry-After` header. Unknown, disabled, passwordless, and incorrect-password accounts count as failures. Successful logins and malformed bodies do not count or reset failures. Blocked retries do not extend the window.
- Password-login attempts use a transaction-scoped PostgreSQL advisory lock per canonical IP. Account verification and session creation share a transaction and an account row lock. Expired failure events are removed by the three-hour API cleanup task. Counters are shared by API processes and retained across restarts.
- `POST /auth/change-password` clears `password_change_required` after current-password verification.
- Password changes lock and revalidate the account, update its password, and revoke every other browser session for that account in one transaction. The current session remains valid. Rejected changes preserve the password and all sessions.
- A session whose user has `password_change_required` can access only the login, password-change, health, session, and logout endpoints.
- The `maintenance reset-password <email>` command reads the new password from `NEW_PASSWORD`, revokes the user's existing sessions, and requires a password change at the next login.
- `apps/web` is the Astro web application. In development, its Vite proxy forwards `/api` requests to the local API process and removes the `/api` prefix.

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
- `POST /mcp` is a remote Model Context Protocol endpoint for active service-account bearer tokens and OAuth access tokens.
- The public web proxy forwards `/mcp` directly to the API's `/mcp` endpoint. `/api/mcp` remains the canonical public resource URL with the default `PUBLIC_API_ORIGIN`. The `mcp` cookbook slug is reserved.
- Astro's built-in Origin check is disabled. The web middleware checks request origins before API forwarding, session validation, and page rendering. Cross-origin or Origin-less unsafe requests with a form content type or no content type receive HTTP 403 with an empty body. `POST /api/oauth/token` with `application/x-www-form-urlencoded` is exempt from this check. Safe HTTP methods, same-origin requests, and non-form content types retain Astro's previous Origin-check behavior.
- The MCP endpoint exposes tools for recipe search, draft retrieval, draft creation, draft metadata updates, and draft step replacement.
- MCP tools do not publish or delete recipes.
- MCP tool input schemas are defined in `apps/api/src/mcp/tool-schemas.ts`. Nullable fields use `anyOf` with separate non-null and null branches. UUID formats apply to the string branch. Tool argument objects reject additional properties; required fields and optional nullable fields are declared separately.
- MCP ingredient and unit creation tools create records owned by the authenticated tenant. They cannot create or modify instance-owned catalogue records.
- MCP user connections use OAuth 2.1 authorization-code flow with S256 PKCE, Client ID Metadata Documents, dynamic client registration, and the `shadowcook:recipes` scope.
- OAuth authorization requests that omit `scope` receive `shadowcook:recipes` as their default scope.
- OAuth redirect URIs use HTTPS or HTTP with the literal loopback address `127.0.0.1` or `[::1]`. Redirect URIs cannot contain credentials or fragments. Registration, authorization, and Client ID Metadata Documents use the same redirect URI validation. Authorization requires a registered redirect URI, and token exchange matches the authorization code's exact redirect URI.
- Dynamic client registration returns `client_id`, `client_name`, `redirect_uris`, and `token_endpoint_auth_method: none`. Additional client metadata fields are accepted and are not persisted.
- `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, and `/.well-known/oauth-protected-resource/api/mcp` publish the MCP resource metadata. `/.well-known/oauth-authorization-server` and `/.well-known/oauth-authorization-server/api` publish authorization-server metadata.
- OAuth authorization responses return the authorization code and state to the registered callback URI without an `iss` parameter.
- OAuth authorization codes expire after five minutes and have one-time use. Access tokens expire after one hour. Refresh tokens expire after thirty days and rotate on use.
- OAuth authorization codes, access tokens, and refresh tokens are stored only as SHA-256 hashes. Their plaintext values and PKCE verifiers are not written to application logs.
- OAuth access tokens represent authenticated human principals and are constrained by their existing tenant memberships and permissions.
- `PUBLIC_API_ORIGIN` is the canonical public HTTPS API origin used in MCP OAuth discovery and token audience binding. It defaults to `${PUBLIC_WEB_ORIGIN}/api`.
- AI context grants are separate from service-account tokens and contain a tenant, creator, recipe or category-subtree scope, a one-time bootstrap token hash, an access-token hash, UTC lifecycle timestamps, and revocation state.
- A user with `recipe:visibility-update` creates an AI context grant for one recipe, one category and its descendants, or the complete tenant cookbook. The grant duration is 4, 8, or 24 hours.
- The one-time bootstrap URL expires after 30 minutes. Its GET response is `no-store`, has `Referrer-Policy: no-referrer`, and returns a read-only bearer token and a reader endpoint manifest.
- The AI context manifest includes the bound tenant's public ID, slug, and display name for resource identification and deep-link construction.
- The AI context manifest includes the public web origin and route templates for cookbook, category, root-recipe, category-recipe, and variant URLs. Category paths are formed from the category slug and ancestor slugs.
- Each AI reader endpoint manifest entry includes its GET method, internal API path, and absolute public URL template with the complete `PUBLIC_API_ORIGIN` path prefix. Reader clients substitute public IDs in the absolute URL template and authenticate every request with the issued access token through `Authorization: Bearer` or the `access_token` URL query parameter. The manifest documents the query fallback for clients without header support and includes `authentication.queryParameter` and `authentication.queryTemplate`.
- AI reader requests use exactly one credential transport. Requests with both an Authorization header and an `access_token` query parameter, repeated query credentials, or malformed credentials receive HTTP 401. Query authentication uses the same token verifier, scope, expiry, revocation, and UTC last-use update as header authentication and applies only to AI reader endpoints. Tokens are not appended to public web links.
- AI reader responses include `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, including authorization and missing-resource responses. API request logs redact `access_token` query values and AI context bootstrap path tokens. External reverse-proxy and access logging must redact or exclude AI context credential URLs.
- AI context manifest restrictions are read-only, no administration, and scope-limited. Current draft reads are permitted inside the selected grant scope.
- AI context bearer tokens are accepted only by the `/ai-context/reader` endpoints. They expose published recipes, immutable published and archived revisions, and the current recipe draft within the grant scope. They do not expose management data or write operations.
- Expired, consumed bootstrap links and expired or revoked AI context bearer tokens are unavailable. Accepted AI context bearer tokens update `last_used_at` in UTC.

### 15.3.1 Public recipe authoring skill

- The API exposes the English, provider-neutral `shadowcook-recipe` skill at `/skills/shadowcook-recipe/v1/SKILL.md`. The public web proxy exposes the same resource under `/api/skills/shadowcook-recipe/v1/SKILL.md`.
- Version 1 resources include `recipe.schema.json`, `references/format.md`, `references/icons.md`, `examples/simple.json`, `examples/variants.json`, `scripts/validate_recipe.py`, `scripts/requirements.txt`, and the downloadable `shadowcook-recipe.zip`. Routes serve only these bundled files without authentication, tenant selection, context grants or database access. Responses use explicit media types, `Cache-Control: public, max-age=3600`, and `X-Content-Type-Options: nosniff`.
- Skill source files reside in `apps/api/skills/v1/shadowcook-recipe`. The API runtime includes this directory. The ZIP contains a `shadowcook-recipe/` folder with all skill resources and fixed UTC entry timestamps. Cookbook exports and skill downloads use the shared ZIP32 DEFLATE archive writer.
- The AI context manifest includes `recipeAuthoring` with the skill name and version, recipe format and version, absolute skill/schema/ZIP/example URLs, and authoring instructions. Resource URLs retain the configured public API prefix. Public skill fetches do not carry AI-context credentials. AI context grants remain scoped and read-only.
- A portable recipe document contains `format = shadowcook-recipe`, `formatVersion = 1`, ingredient and unit catalogues, one recipe and optional recipe references. The normative structural contract is JSON Schema Draft-07. Format-version compatibility is independent of database migrations and the AI-context manifest version.
- Ingredients, units, steps, entries, variants and recipe references use document-local keys. Recipe steps and entries use array ordering. Entries are catalogue ingredient usages, free-text usages or semantic special entries. Special entries permit a note and prohibit ingredient, amount, unit, text and optional fields. Authored text retains its language.
- The recipe authoring skill restricts left-column entry text and notes to compact technical data: ingredient/component names, quantities, units, preparation states, temperatures, durations and parameters. Prose, explanations, tips and complete warnings belong in step instructions. Special-entry icons may omit their notes. Dedicated warning steps belong to all affected variants. This authoring rule has no automatic prose classifier in the structural validator.
- Structured recipe quantities are authoritative in skill authoring. Notes must not contradict, repeat or weaken them with same-unit amounts, ranges or approximation qualifiers. Compatible approximate equivalents in other units may supplement a structured quantity. Range-only quantities omit an invented exact amount. The skill's manual validation checklist includes quantity-note consistency; the structural validator does not detect natural-language contradictions.
- Variants explicitly select ordered step keys. Variant slugs are unique; exactly one variant is default and visible; every step belongs to at least one variant. Category paths are root-to-leaf name suggestions for import review.
- Decimal amounts and conversion values are exact strings with at most twelve integer and twelve fractional digits. Unit conversion metadata defines dimension, positive factor and offset against grams, millilitres, individual counts or degrees Celsius. Unknown conversions are omitted; only temperature conversions may have non-zero offsets.
- Optional source identities contain the public instance URL, tenant public ID and entity public ID. Instance-owned units use a null source tenant. Recipe provenance additionally supports known source revision and lineage public IDs. These fields are unverified claims and confer no access or federation trust. Unknown source identities are omitted.
- Portable recipe references use `{recipe:<document-local-key>}` tokens and known credential-free HTTP(S) recipe URLs. JSON draft import converts these references to authored title-and-URL text.
- The bundled Python validator uses `jsonschema` for structural validation and checks unique keys/slugs, resolved references, alias selection, variant defaults and memberships, duration consistency, and credential-free source/reference URLs. Duplicate JSON properties and non-finite JSON number constants are rejected. Schema validation alone does not establish referential integrity or provenance authenticity.
- The skill returns a JSON document to the user and documents the reviewed draft import workflow in section 15.3.2. AI-context reader credentials do not authorize import. Authenticated federation import and trusted reusable source mappings remain unimplemented.

### 15.3.2 Recipe JSON upload and draft import

- `/{tenantSlug}/manage/recipes/import` is an authenticated, deep-linkable cookbook management page. Users with `recipe:create` can open it through the Import Recipe action on `/{tenantSlug}/manage/recipes`, before Create Recipe. The cookbook recipe list and tenant navigation contain no Import Recipe action. The English and German UI locale dictionaries resolve input labels, accessibility text, validation messages, match labels and API failures.
- A labelled radio group selects JSON-file input or pasted JSON. Both inputs submit the same UTF-8 JSON text to the API. The import wizard has four steps: source input, an informational recipe overview, editable recipe head data, and assignment tables. Next and Previous navigate the steps; Finish submits the import from the final step. Backward navigation preserves input, variant names, category choices and catalogue selections. A changed source document resets the review after validation. Unused catalogue declarations do not create entities.
- The import page accepts a single JSON file dropped anywhere on the page, including in paste mode and during review. A page overlay marks an active file drag. Dropping a file selects file mode, reads the file and automatically requests the read-only preview. A valid document opens the recipe overview. File selection and file drops share the 1 MiB limit and JSON-file checks. The source step displays the selected filename. File drops are blocked while reading, submitting or displaying an error dialog. Saving a draft requires Finish.
- The informational overview renders authored recipe text, preparation steps, variant names and metadata without editable controls. Head data includes an editable recipe title, the URL slug, categories and editable names and URL slugs for each variant. Titles require non-whitespace text and have a maximum length of 240 characters. Title edits update the proposed slug while it matches the previous title's generated slug. The overview and submitted document use the edited title with surrounding whitespace removed. Empty variant names use the UI locale's default variant label. Initial variant names matching that label and name edits to that label or empty text reset the variant slug to `default`. Variant slugs remain manually editable after this reset. Variant slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, contain at most 160 characters and be unique within the imported recipe. Edited names and slugs are included in the submitted document. Variant flags and explicit step memberships remain intact.
- Ingredient and unit mappings use tables with original-entry and assignment columns. Ingredient rows additionally provide an Add as alias checkbox. Searchable comboboxes show the new-entry choice first when permitted, followed by the original entry's ranked suggestions and a separate group of filtered existing entries. Selecting a new entry clears the alias flag and displays its checkbox unchecked and disabled. Opening a combobox without search text loads the first 25 visible catalogue entries. Searches are debounced, obsolete requests are cancelled, and selected search results survive wizard navigation. The comboboxes support arrow keys, Enter, Escape and Tab with labelled listbox groups and active options.
- `POST /cookbook/tenants/{tenantSlug}/recipe-imports/preview` validates recipe text and returns the document, creation capabilities, catalogue candidates and unambiguous suggestions without writing data. `GET /cookbook/tenants/{tenantSlug}/recipe-imports/catalogue` searches visible catalogue names, ingredient aliases, unit symbols and unit translations, returning at most 25 candidates. All import routes require `recipe:create` and return `Cache-Control: no-store`.
- Import previews include the complete category tree of the receiving cookbook, including empty categories. `GET /cookbook/tenants/{tenantSlug}/editor-catalogue` exposes the same category tree with visible units to principals with `recipe:create` or `recipe:update`. The ordinary recipe editor uses this catalogue for category selection independently of published cookbook navigation.
- Validation uses the bundled v1 JSON Schema without fetching a document's `$schema` or source URLs. Duplicate JSON properties, unresolved references, duplicate entity/source identities, invalid variant membership/defaults, inconsistent durations and credential-bearing source/reference URLs are rejected. The document limit is 1 MiB UTF-8 text with depth 64, 500 ingredient declarations, 200 unit declarations, 500 steps, 50 variants, 100 recipe references and 5000 entries. HTTP request bodies allow 4 MiB for the JSON string envelope. Validation failures expose stable issue codes and JSON paths; the web UI resolves their wording through its locale dictionary.
- Ingredient candidates belong to the receiving cookbook. Matching compares normalized names and aliases and ranks additional candidates by bigram similarity. Exact names and aliases are preselected only for one unambiguous candidate. Similar matches require explicit selection. Existing unit candidates belong to the instance or receiving cookbook. Known source definitions require equal dimension, exact factor and exact offset; amounts and authored unit choices are not converted. Unknown source definitions have no preselection. Stored unit translations are used for search and localized candidate display.
- The user can select an existing candidate, search for another, or choose creation of a new ingredient/unit. Creation permits editing the new name and unit symbol. Ingredient creation requires `ingredient:create`; unit creation requires `unit:create`; importing additional variants requires `variant:create`. Existing ingredient canonical names and unit definitions are retained. Existing ingredient aliases are retained when they match the authored usage name. New ingredients retain their supplied aliases.
- Existing ingredient mappings accept optional `addAsAlias`. A true value requires `ingredient:update` and adds the document ingredient's original name as an alias of the selected ingredient. `permissions.canAddIngredientAliases` exposes this capability in previews. Equivalent canonical names or aliases are reused without duplicate alias creation. Alias additions, new catalogue entries and the recipe commit in the same transaction; a failed import leaves no aliases behind. Unit mappings and new-entry selections do not accept the alias option.
- `POST /cookbook/tenants/{tenantSlug}/recipe-imports` revalidates the complete document, selection coverage, permissions, tenant ownership, category ownership, unit definitions and catalogue-name conflicts. Catalogue creation and the new draft execute in one PostgreSQL transaction. Conflicts or invalid selections roll back all writes. Concurrent imports in one receiving cookbook serialize catalogue creation by locking its tenant row.
- Successful import generates new local recipe, revision, variant, step and usage IDs, preserves ordered instructions/entries and explicit variant memberships, writes recipe metadata, diet, category assignments and contributor attribution, and opens the ordinary recipe editor. The recipe has no published revision and is not featured. Category assignment can remain empty until publication.
- Optional known recipe lineage is retained. `recipe_import_source`, `recipe_import_ingredient_source` and `recipe_import_unit_source` store normalized, unverified source claims and their local entity relationships. Instance-owned remote units have a null remote tenant ID. These records do not populate `recipe_upstream`, grant cross-cookbook access, or establish trusted federation mappings.
- Cookbook content export includes `import_sources.recipes`, `import_sources.ingredients` and `import_sources.units` with local public IDs and unverified remote identities. Import-source records participate in the export's read-only repeatable-read snapshot. Full cookbook ZIP import, authenticated federation transport and automatic upstream synchronization remain unimplemented.
- Instance-owned units referenced by retained import-source records are included in cookbook exports even after their recipe usages are removed.

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

All recipe-content changes go through a draft. Recipe-level metadata changes apply directly to the recipe.

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

The integration model is AI-provider-neutral. ChatGPT, Claude, a local model, or another agent may use the remote MCP endpoint, the published Reader API, or a scoped AI context reader manifest. Shadowcook does not require recipe-development conversations to be processed by a specific AI provider.

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
- MCP adapters,
- scoped AI context reader manifests.

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

Ingredients and units must be mapped to local entities.

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

### 21.5 Local normalization boundary

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

The cookbook content download is implemented in BETA-2. Identity-bearing full backup and restore remain Version 2.5 features.

### 27.0 Cookbook content download

- Cookbook management provides a localized `Download Cookbook` action for principals with `tenant:manage`. The initial Owner role has this permission. Instance permissions alone do not grant export access.
- `GET /cookbook/tenants/{tenantSlug}/export` accepts session, service-account bearer, and OAuth bearer authentication. Authentication, completed password-change requirements, an enabled tenant, and tenant-scoped `tenant:manage` permission are required.
- The response is an `application/zip` attachment named `{tenant-slug}-{YYYYmmddTHHMMSSZ}.shadowcook.zip`. It uses `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- The archive contains one UTF-8 `cookbook.json` document with `format = shadowcook-cookbook`, `format_version = 1`, and a UTC `exported_at` timestamp. The content-format version is independent of database migrations.
- The document contains cookbook metadata and every general setting, the complete category hierarchy including empty categories, all tenant ingredients and aliases, all tenant units and any additional units referenced by retained revisions, unit translations and conversion data, every recipe, every published and archived revision, all drafts, all variants and their explicit step memberships, all steps, and all ingredient usages.
- Recipes retain public IDs, lineage IDs, slugs, visibility and discoverability overrides, featured flags, and active published/draft revision references. Revision-scoped variant, step, and usage keys remain intact. Authored text and embedded recipe-reference tokens are unchanged. Relationships use public IDs or revision-scoped keys, without database-internal IDs. Decimal amounts and unit conversion factors are exact strings.
- Export queries execute in one read-only PostgreSQL repeatable-read transaction with UTC timestamps, without pagination or publication, discoverability, or visibility filtering.
- Account data, memberships, passwords, session and API tokens, invitations, live sharing grants, operational credentials, and tenant identity keys are excluded. Author attribution includes the current display name only.
- The content export includes the implemented JSON cookbook model and revision cover images. Each exported revision contains `image: null` or an object with `content_type = image/jpeg`, `encoding = base64`, and `data` containing the exact stored JPEG bytes as Base64 without a data URL prefix. Draft, published, and archived revisions export their remaining image associations. Revisions whose cover references have expired under the image-retention policy export `image: null`. Export format version 1 is retained; older archives can omit `image`.
- Thumbnails and source originals are not embedded. Thumbnails can be regenerated from the embedded 1200 × 800 JPEG. Files shared by multiple revisions are read once per export and embedded in each referencing revision. File bytes are checked against the stored SHA-256 checksum. Missing or mismatching image files fail the export; no incomplete archive is returned. Storage keys, filesystem paths and image access URLs are excluded.
- Federation relationships and cryptographic identity migration belong to the full portable backup format below. Cookbook content import is not implemented.
- ZIP generation uses Node.js raw DEFLATE and CRC32, with one ZIP32 entry and UTC archive timestamps. Export does not mutate cookbook data or write temporary server files.
- The browser downloads the binary attachment, disables repeated download submissions while preparing it, and displays locale-resolved failures through the shared application error dialog.

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
- units and categories needed for restore,
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

Ingredients and units may require both commonly shared/system catalogue records and tenant-owned custom records.

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

Recipe text revisions are retained independently of cover-image retention. Each recipe retains the configured number of most recently published distinct cover assets, including its current published image when present, plus the active draft image. The instance default is five. A zero limit preserves unlimited published cover history. Cover references outside this history window are removed from archived revisions. Those revisions remain readable without an image. Other retained media references continue to protect shared assets from deletion.

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

- additional inline media and object-storage backends,
- pantry ingredient matching,
- portion scaling, timers, cooking mode, favorites, and AI-assisted cooking sessions,
- tenant-owned federation sharing policy,
- tenant-to-tenant grants,
- invitation-based trust bootstrap,
- cryptographic tenant identity and delegated federation keys,
- pull-based federation,
- recipe import/fork with upstream tracking,
- persistent ingredient/unit federation mapping,
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

Requires curated density/conversion data and possibly condition-aware conversion rules.

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

### 35.5 Cookbook update subscriptions

- A cookbook owner can enable or disable followers for the cookbook.
- Authenticated users can follow a cookbook only while following is enabled by its owner.
- An instance administrator configures the maximum automated update-delivery rate as a minimum interval between deliveries, such as one delivery per day, three per week, one every two days, or one per month.
- A cookbook owner selects an automated update-delivery interval that is equal to or less frequent than the instance limit.
- At each selected delivery time, the server groups recipe publication updates made since the preceding delivery for each followed cookbook and sends one update to its followers.
- The application records these deliveries as user notifications. Unread update notifications are visible live through the global notification symbol and link to the affected cookbook or recipe.
- Cookbook owners do not compose, select, or manually send newsletter deliveries.

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
13. Preparation state belongs to an IngredientUsage note, not ingredient identity.
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
  attaches a normalized ingredient, quantity, unit, optional flag, and note to a step

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

The legacy cookbook migration is a separate local workspace application. It is not part of the API process or runtime deployment images. It reads only categories, recipes, category assignments, steps, ingredient usages, and units from the HSQLDB source through a read-only connection. Legacy users are not read or migrated.

Migration configuration is isolated in the untracked `.env.migration` file. Source connection settings use the `SOURCE_DB_*` namespace. PostgreSQL target connection and tenant settings use the `TARGET_DB_*` namespace. The migration application does not load runtime API environment files.

The migration targets one existing empty tenant. Its single Owner is the default author of imported recipe revisions; a configured tenant-member principal may override the author.

The migration writes one published revision and one default variant for each legacy recipe in one PostgreSQL transaction. A dry run executes the complete transaction and rolls it back. Category and recipe URL slugs are deterministic and tenant-unique.

The legacy technical root category is not persisted. Legacy usages with real units create tenant-owned ingredients or reuse matching instance- or tenant-owned ingredients. Ingredient text before the first comma and outside parentheses is the ingredient name. Parenthetical text and text after the first comma are authored usage notes. Standard units use the instance catalogue, and missing legacy units become tenant-owned units. Legacy special-unit identifiers map to semantic special-entry kinds. The importer removes angle-bracketed legacy captions and preserves any remaining special-entry text as a note.

Legacy thumbnail references are reported and omitted. Legacy image ingestion is not implemented.

---

## 39. Tenant ingredient catalogues

Tenant-owned ingredients and aliases are stored in the shared normalized ingredient catalogue with `owner_tenant_id` set to the owning tenant. Instance-owned standard ingredients have a null owner tenant.

Recipe-editor catalogue search returns instance-owned and current-tenant ingredients. It searches canonical names and aliases and returns an exact-match indicator for the submitted search value.

Tenant ingredient administration and on-the-fly ingredient creation use tenant ingredient permissions. Tenant ingredient administration exposes only ingredients owned by the current tenant.

Tenant ingredient lists and alias lists sort names case-insensitively. Recipe-editor ingredient search places exact matches first and sorts names case-insensitively within each match group. Public IDs break ties between equal case-insensitive names.

Cookbook management navigation and direct management routes require a tenant management or content-write permission. Read permissions do not grant management access. The initial Viewer role cannot access cookbook management. Ingredient management lists require `ingredient:create` or `ingredient:update`. Unit management lists require `unit:create`, `unit:update`, or `unit:delete`. Recipe draft lists require `recipe:create` or `recipe:update`. Each mutation requires its operation-specific write permission.

Tenant ingredient consolidation uses the tenant ingredient update permission.

Tenant-owned units of measure use the shared normalized unit catalogue with `owner_tenant_id` set to the owning tenant. Tenant unit administration exposes only units owned by the current tenant. Recipe-editor unit selection includes instance-owned and current-tenant units.

## 40. Architectural direction

Shadowcook 2.0 is a content-first, tenant-owned, federated cookbook platform whose architecture deliberately treats recipes as portable, shareable, versioned domain objects.

The intended result is that Ursula and Petra can exchange recipes as naturally as people have always exchanged recipes, while Shadowcook handles identity, synchronization, history, conflict resolution, and transport behind the scenes.

At the same time, a technical user may self-host the exact same software, connect AI agents, expose public recipes, automate curation, and migrate the entire cookbook without depending on a central Shadowcook service.

That combination is the defining architectural direction of Shadowcook 2.0.

Portable recipe variants accept optional `metadata` and `diet`. Legacy recipe-level fields supply defaults for variants that omit these fields. Explicit null diet overrides a legacy default. A supplied variant metadata object replaces the legacy object.

### Recipe cover image implementation

- A recipe revision references at most one `COVER` asset through `recipe_revision_media`. Draft creation copies the reference. Upload and removal require `recipe:update` and modify the draft. Publication retains the configured number of most recently published distinct cover assets per recipe (default five; zero is unlimited), ordered by their latest referencing published revision number; repeated publication of an unchanged asset consumes one slot. The active draft image is protected separately. Archived cover references outside the window are removed without deleting recipe revisions or their text. Historical reader and export responses expose null images after reference removal.
- The editor accepts JPEG, PNG and WebP files up to 30 MiB and 40 megapixels. A localized preview supports direct dragging, zoom from 0.1 to 3, and horizontal/vertical position controls for a 3:2 crop. Zoom below 1 can leave empty areas around the image. Preview and JPEG export use the same canvas renderer and fill empty or transparent areas with the computed cookbook page background color from the document root. Position controls and dragging work for both cropped images and images with padding. Browser decoding applies image orientation. The browser uploads only a 1200 × 800 JPEG crop as base64 JSON.
- The API limits upload requests to 1,410,000 bytes, validates JPEG format and exact dimensions with Sharp, strips metadata and re-encodes at quality 80. Stored main images have at most 500,000 bytes. A 360 × 240 thumbnail at quality 75 has at most 60,000 bytes. Original source files are not persisted.
- `media_asset` stores media identity, tenant ownership, storage key, JPEG type, combined file byte size and SHA-256 checksum of the main JPEG. Binary files reside under `SHADOWCOOK_MEDIA_DIRECTORY` (default `./var/media` relative to the API working directory), in generated UUID directories. Each directory contains `image.jpg` and `thumbnail.jpg`.
- Both deployment Compose configurations mount the persistent project-scoped `recipe_media` Docker volume at `/var/lib/shadowcook/media`. Docker manages the host storage location, as for the bundled PostgreSQL volume. The deployment `.env` exposes no media host-path setting. Operators configure external storage through Docker volume drivers or Compose overrides. The API requires filesystem read, write, directory creation/listing, file metadata and recursive removal operations with access for container UID/GID 1000:1000. Native S3 storage is not implemented. Changing an existing storage backend requires copying existing media. Media backups include the volume or its external backing storage alongside the database backup.
- Recipe summaries, reader details, shared details, editor drafts and revision snapshots expose nullable `image_url`. Cards request thumbnails. A card header places the image in its left third and the recipe title and diet icon in its right two thirds. Variant labels, summary and categories follow below at full card width. Cards without images use the full header width for the title. Detail views and PDF covers use the main image. Browser detail images have a maximum width of 38.4rem and occupy the left overview column above the summary, with their top edge aligned to the shopping list on desktop. Narrow layouts stack the overview content and shopping list. PDF generation embeds fetched image bytes.
- Media reads require visibility of the published recipe, `recipe:update` for draft/history images, or a valid share token for the current published revision. Disabled tenants cannot serve media. Media responses use `private, no-store` and `nosniff`. Share tokens in media URLs are redacted from API request logs.
- Instance administrators configure `maxPublishedRecipeImages` through the deep-linkable `/admin/settings/media` page and `GET`/`PUT /admin/media-settings`. `instance_media_settings` stores a singleton non-negative PostgreSQL integer, initialized to five, plus the updating principal and timestamp. Zero disables published-history pruning; positive values set the maximum, including the current published image. The active draft is protected separately. No environment variable controls this setting. The UI supports English and German labels, help, validation and save feedback. Changes take effect at the next publication or hourly cleanup without restarting the process. Increasing the limit does not restore deleted images.
- Retention reads the current setting for each recipe transaction under a shared settings-row lock. The maintenance candidate scan reads the current limit and each recipe transaction rechecks it. A zero limit skips history pruning but preserves ordinary orphan and abandoned-upload cleanup.
- Publication prunes cover history in the same transaction while holding the recipe row lock. Newly unreferenced expired assets are deleted from the database in that transaction, and their main image and thumbnail files are removed after commit. Assets referenced by other recipes, active drafts or other media usages are preserved. Filesystem removal failures are logged without reverting a successful publication. Hourly cleanup applies the same retention policy to existing recipe histories under per-recipe row locks, deletes other unreferenced media records older than 24 hours and their files, and removes UUID storage directories older than 24 hours without a media record.
