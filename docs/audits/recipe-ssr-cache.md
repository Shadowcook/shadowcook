# Recipe structured data, SSR payload and caching audit

Audit date: 2026-11-11. All test accounts and recipe fixtures are synthetic. No authenticated production HTML exports were used.

## Structured recipe data

**Confirmed defect:** `recipeJsonLd` mapped only `step.instruction` into `HowToStep.text`. The UI independently rendered `step.ingredients[].note`. Moving a duration into a `WAIT` entry therefore removed it from structured instructions.

The exporter now reads the complete step and appends non-empty special-entry notes to that step. It preserves authored ranges such as `30-40 Minuten` without synthesizing ISO durations. Identical notes in one step are deduplicated; notes already contained in its instruction are not appended again. Ordinary ingredients retain their existing export behavior.

All ten kinds can carry execution guidance: `NO_ICON`, `REMOVE`, `ADD`, `INFO`, `IMPORTANT`, `COOK`, `COOL`, `HEAT`, `WAIT`, `WORK_STEP`. None of their authored notes is excluded. Empty entries contribute no invented text. Notes retain their author's language. Existing script serialization escapes `<` before insertion into HTML.

Tests cover every kind, null/blank notes, duplicate notes, notes already in the instruction, step isolation, valid JSON and WAIT in the rendered UI and JSON-LD.

## Session and authorization boundary

**Finding:** all four existing header fields are used: authentication selects the menu, email/display name identify the account, and the administration flag controls its navigation link. Removing them would remove current SSR behavior. The loader already projects exactly these four fields rather than spreading the authentication response. A regression test verifies that extra internal identifiers and synthetic credentials from an upstream response do not enter header props.

Anonymous, member A, member B and repeated anonymous reads are exercised against the built Astro server. Neither identity crosses into another response. These tests use a synthetic upstream API; independent database-backed tests check permission differences, forbidden publication and denied administration.

API authorization uses the requesting principal and `requireInstancePermission`/`requireTenantPermission`; it does not accept the hydration flag as authorization. Cookbook and recipe readers join `recipe.published_revision_id`, not a mutable draft. A database-backed regression verifies that a draft-only recipe is absent from public detail and overview reads and that edits remain unpublished until publication.

**Confirmed configuration gap, not a demonstrated leak:** successful recipe HTML and most successful API responses lacked explicit cache instructions despite containing identity or permission-dependent content. Dynamic HTML and page redirects now use `private, no-store`, as do API successes by default. Errors retain `no-store`; explicit endpoint policies, including public skill resources, remain intact. This prevents storage by conforming browser/shared HTTP caches. A proxy configured to override origin policy remains outside these tests.

## Payload and hydration

**Confirmed cause:** `RecipePage.astro` passed the complete overview to `CookbookScreen`, although a detail render displays only one recipe. Session restoration also fetched the complete overview immediately after hydration.

Detail hydration now retains only the current recipe summary and removes the featured recipe list. The category tree remains available for route resolution and breadcrumbs; tenant/capability data and the complete selected recipe remain available for existing controls. Initial session restoration reuses this data. Breadcrumb and back links load their overview route; variant changes use the current summary. Browser history restoration continues to fetch the overview as needed. The server still fetches the overview to resolve recipe/category slugs; this change does not optimize backend query volume.

### Measurements

The local test uses the built Astro server on random ports, a synthetic API, 101 recipe summaries, two nested categories and one selected recipe. The baseline build differs only by passing the full overview to the recipe island. These are HTML document sizes, excluding separate JavaScript, CSS and image downloads.

| Measurement                                      | Full overview | Reduced detail props |
| ------------------------------------------------ | ------------: | -------------------: |
| HTML, bytes                                      |        156794 |                29971 |
| gzip estimate, bytes (`node:zlib.gzipSync`)      |         11569 |                 8283 |
| Local HTTP content encoding when requesting gzip |          none |                 none |

HTML decreases by about 81%; the gzip estimate decreases by about 28%. The built Node server does not itself compress HTTP responses. The gzip column is explicitly an estimate, not a measurement of deployed compression after rollout.

A real Headless Chrome regression uses a temporary profile and the built server, waits for both islands to finish hydration, checks the duration and nested category backlink, and counts API requests. Only one overview request occurs (server route resolution), with no overview request during hydration. Run it with `SHADOWCOOK_TEST_CHROME=/usr/bin/google-chrome node --test apps/web/test/integration/landing-routing.test.ts`. Without that environment variable the optional browser test is skipped. It measures completion and request behavior, not a stable CPU-time improvement. Existing direct category/recipe/variant and repeated SSR request tests remain in place.

## Public freshness and deployment observation

An anonymous cookie-free GET to [the referenced recipe](https://shadowcook.net/cookin-with-m/recipes/currywurst) at **2026-11-11 10:42:55 UTC** returned HTTP 200, `Server: cloudflare`, `CF-Cache-Status: DYNAMIC`, `Vary: Accept-Encoding` and `Content-Encoding: gzip`. It returned no `Cache-Control`, `ETag`, `Last-Modified` or `Age`. The gzip wire body was **24528 bytes**, decompressing to **163286 bytes**. This measures the deployed pre-fix application, not the local changes.

The supplied Nginx and Apache examples configure no shared response cache; the Node web server has no application response cache or HTTP compression layer. Cloudflare exists in the observed live path, but its account configuration is not available locally. A `DYNAMIC` observation does not prove the behavior of every edge or historical request.

**Not reproduced:** stale published content in a fresh application read. Publication updates the active revision pointer and commits before returning. The database-backed test publishes twice, checks the old revision during draft editing, then reads the new revision immediately as two users and anonymously. The SSR test independently changes the synthetic upstream published recipe and checks the next HTML read for all three identities. No cache invalidation mechanism or ETag was invented: the implemented freshness contract is an uncached read of the current committed publication. Requests already in flight and already open pages are not live subscriptions.

The historical external stale quantities remain unexplained. After deployment, repeat the anonymous compressed GET and authenticated/anonymous isolation checks through the actual proxy/CDN path, verifying the new cache header and measuring actual compressed sizes. Local tests cannot establish a post-deployment wire size or reproduce an unknown external tool's earlier cache state.

## Validation commands

- `npm --prefix apps/web run test:unit`
- `npm --prefix apps/api run test:unit`
- `npm --prefix apps/web run check`
- `npm --prefix apps/api run check`
- `npm --prefix apps/web run build`
- `SHADOWCOOK_TEST_CHROME=/usr/bin/google-chrome node --test apps/web/test/integration/*.test.ts`
- In `apps/api`: `NODE_ENV=test node --import tsx --test test/api/recipe-step-variants.test.ts` (disposable Docker PostgreSQL, random port; no development database).

API cache defaults are documented in `contracts/openapi.yaml`. No endpoint, request body, response body, database schema or migration changes are required.

## Results and changed files

All validation commands above passed: 25 web unit-test files, 42 API unit tests, 23 built SSR/proxy/browser integration tests (including the optional Chrome test), and four database-backed step/publication tests. Web and API type checks passed; Astro reported zero errors, warnings or hints. The web production build succeeded. Formatting and `git diff --check` passed. The integration suite also verifies that authored special notes containing script end tags remain valid escaped JSON-LD.

Changed files:

- `apps/web/src/features/cookbook/server/recipe-structured-data.ts`: complete step-note export.
- `apps/web/src/features/cookbook/server/recipe-page-cookbook.ts`: detail payload projection.
- `apps/web/src/features/cookbook/server/RecipePage.astro`: use the reduced island payload.
- `apps/web/src/features/cookbook/CookbookScreen.tsx`: reuse initial detail data during session restoration.
- `apps/web/src/middleware.ts`: uncached dynamic documents and page redirects.
- `apps/api/src/security/error-handling.ts`: default successful API cache policy.
- `apps/web/test/unit/recipe-structured-data.test.ts`: special kinds, ranges and deduplication.
- `apps/web/test/unit/head-bar-session.test.ts`: session field projection and anonymous isolation.
- `apps/web/test/integration/landing-routing.test.ts`: synthetic overview fixture, SSR/JSON-LD, measurements, isolation, freshness, escaping and optional real browser hydration.
- `apps/api/test/unit/error-handling.test.ts`: default cache policy and explicit-policy preservation.
- `apps/api/test/api/recipe-step-variants.test.ts`: real publication freshness, unpublished-content isolation and denied privileged actions.
- `contracts/openapi.yaml`: common API cache policy.
- `docs/ARCHITECTURE.md`: current rendering, session and freshness behavior.
- `docs/audits/recipe-ssr-cache.md`: evidence, measurements, methods and limits.
