# Roadmap

Unimplemented capabilities and feature ideas. Items have no assigned priority, release, or delivery date. Implemented capabilities are documented in [ARCHITECTURE.md](ARCHITECTURE.md).

## Backlog

### Federation and cross-cookbook sharing

#### Tenant identity and trust

- Federation identity consists of the tenant public UUID and cryptographic identity. Instance URLs are locators.
- Each tenant has a long-lived Ed25519 identity key and delegated shorter-lived Ed25519 federation keys.
- Delegation records bind tenant identity, federation public key, key ID, validity interval, and optional purpose/capabilities, signed by the identity key.
- Standard HTTP message signatures cover method, authority, path, content digest, creation/expiry times, and nonce. Receivers validate the signature, delegation, timestamps, nonce uniqueness, tenant grant, and recipe policy.
- Identity-key succession requires a verifiable chain from the prior key and acknowledgement by the replacement key.
- A valid identity or signature does not grant content access. The local host is trusted to operate tenant data; federation cryptography does not protect against its root administrator.
- One-time, expiring invitations bootstrap directional tenant grants. Invitations store a token hash, origin tenant, requested permissions, expiry, claim state, claimant identity, and creator.
- Cross-instance invitation links transfer to the recipient's home instance. A selected local tenant proves its identity before the origin consumes the invitation and creates the grant.
- Email delivers invitations and is independent of tenant identity. Trust relationships survive email changes.
- Grants contain explicit rights such as recipe listing, reading, revision reading, and synchronization. They do not grant remote editing, deletion, or publication. Recipe-level denies take precedence over broader grants.
- Same-instance and cross-instance sharing use the same policy semantics. Cross-instance operations use signed federation transport.
- Federation discovery advertises instance identity, protocol versions, and API entry points. Transport is pull-based.
- Remote requests validate destination schemes, resolved addresses, redirects, response sizes, and timeouts. Localhost, private, and link-local addresses require explicit networking policy. DNS and redirect destinations are revalidated.

#### Imports, mappings, and lineage

- Federation imports create complete local recipe copies that survive source deletion, access loss, unavailability, and relocation.
- Remote objects use tenant, recipe, and revision public identities. Remote database row IDs are not local identities.
- Ingredient and unit mappings persist per origin entity across recipes and revisions. Existing mappings are reused; unique safe matches can be selected automatically; ambiguous or missing matches require user selection or local creation.
- Ingredient matching uses normalized names, aliases, remote identity, and curated mappings. Manual mappings are not overwritten by heuristics. Unit matching also checks dimensions and conversion definitions.
- Imported recipe content references local catalogue identities after mapping.
- A lineage public ID survives import, edits, renaming, variants, re-sharing, and upstream merges. Only explicit detachment creates a new lineage.
- A tenant normally owns at most one recipe per lineage. Fork provenance records immediate upstream and root origin where known.
- Each local recipe has at most one primary upstream. Upstream state includes origin and immediate source identities, locator, last merged/latest known revisions, grant reference, status, and UTC check timestamp. Statuses include `ACTIVE`, `REMOVED`, `ACCESS_LOST`, and `UNREACHABLE`.
- Upstream relationships must not create provenance cycles. Other recipes of the same lineage are related forks and do not automatically become update sources.

#### Remote updates and comparison

- Periodic upstream checks group requests by source. New revisions are offered to editors and never silently overwrite local state.
- Three-way merge compares the last imported/merged remote base, the new remote revision, and current local state.
- A change on only one side is retained; equal changes are retained once; differing changes on both sides conflict.
- Upstream deletion removes an unchanged local entity and conflicts with a locally modified entity.
- Stable step, variant, and usage keys identify entities. Ordering supports concurrent insertions.
- Related forks are available for explicit viewing, comparison, and selective merge when access permits. Comparison does not change the primary upstream automatically.
- Revision provenance forms a directed acyclic graph of contributing historical revisions.
- Lineage, provenance, and trackback obey recipe visibility, grants, and sharing policy. Hidden forks are not exposed through counts or placeholders.

#### Subscriptions and discovery

- A subscription selects a source cookbook for discovery and does not itself grant access.
- Incremental discovery returns recipe and lineage identities, title, slug, summary, current revision, publication timestamp, and permitted provenance/thumbnail metadata.
- Known lineages are excluded from new-recipe offers and may appear as related forks when authorized.
- Offer decisions are sync, defer, or ignore. Sync starts import/mapping and upstream tracking. Deferrals use increasing backoff associated with recipe identity rather than revision. Ignore suppresses automatic offers indefinitely; manual import remains available.
- Local offer state records subscription, remote recipe identity, pending/deferred/ignored state, deferral count, next offer time, first/last seen times, and last seen revision.
- Background workers check upstream revisions, poll subscriptions, and handle remote health and backoff.

### Portable tenant backup, restore, and migration

- A full tenant backup is a versioned Shadowcook archive independent of the database schema.
- It contains tenant metadata, recipes, complete published history, active drafts, variants, required catalogue entities, categories, media, federation mappings, upstream/lineage provenance, restorable sharing metadata, and tenant identity/key history.
- The manifest contains component checksums. Account passwords, session/API/invitation tokens, and instance mail/server credentials are excluded. Operational federation credentials can require reauthorization after restore.
- Optional password protection encrypts the identity private key using a password-derived key. Unencrypted identity-bearing archives require a warning that possession permits tenant impersonation.
- Restore-as-copy creates a new tenant identity. Original-cookbook restore preserves tenant identity, recipe public IDs, lineage IDs, history, mappings, and contents.
- Format, checksum, mapping, and compatibility validation precede the final restore transaction. Failed restore does not leave partial cookbook state.
- Migration changes the instance locator while preserving tenant identity. Remote peers verify location changes through the cryptographic identity.
- Backup reminders support snoozing and disabling and use the last successful export time.

### Interactive recipe tools

- Portion scaling.
- Recipe timers.
- Cooking mode.
- Favorites.

### Pantry matching

Identity-based pantry matching uses distinct required ingredient identities from the selected variant. Optional ingredients do not block a match. Results group recipes by the number of missing ingredients. Quantity-aware inventory also compares available amounts using unit conversion.

### Ingredient conversion and substitution

Ingredient-specific mass/volume conversion uses curated ingredient properties, preparation conditions, source, and precision. Ingredient substitution represents alternatives and substitution quality.

### AI-assisted cooking sessions

Cooking sessions associate observations with a mutable recipe draft. Observations remain separate from instructions until explicitly converted to draft edits. Authorized assistants can read recipe state, edit drafts and variants, record observations, and compare changes. Publishing requires `recipe:publish`. Integrations are provider-neutral.

### Optimistic locking for recipe editing

Concurrent editor and agent writes use expected revision versions or ETags. Stale writes are rejected for reconciliation.

### Cookbook update subscriptions and notifications

- A cookbook owner can enable or disable followers for the cookbook.
- Authenticated users can follow a cookbook only while following is enabled by its owner.
- An instance administrator configures the maximum automated update-delivery rate as a minimum interval between deliveries, such as one delivery per day, three per week, one every two days, or one per month.
- A cookbook owner selects an automated update-delivery interval that is equal to or less frequent than the instance limit.
- At each selected delivery time, the server groups recipe publication updates made since the preceding delivery for each followed cookbook and sends one update to its followers.
- The application records these deliveries as user notifications. Unread update notifications are visible live through the global notification symbol and link to the affected cookbook or recipe.
- Cookbook owners do not compose, select, or manually send newsletter deliveries.

### Historical recipe revision restoration

Copy a historical recipe snapshot into a new mutable draft for review and publication as a new revision. Published and archived revisions remain immutable.

### Cookbook content archive import

Import the versioned cookbook ZIP archive into a new cookbook, including metadata, settings, category hierarchy, catalogue entries, recipes, drafts, complete revision history, variants, memberships, contributor attribution, source claims, and embedded cover images. Preserve portable public identities and exact decimal values; regenerate thumbnails from embedded JPEGs. Validate archive content, references, and checksums before committing cookbook data.

### Recipe editing and policy audit events

Record draft edits and recipe policy changes separately from immutable revision snapshots. Events include tenant, principal, recipe/revision, operation, entity identity, before/after values, request identity, and UTC timestamp. Visibility, discoverability, featured state, and slug changes do not create content revisions.

### API validation schemas

Define API validation schemas with TypeBox and JSON Schema.

### Component style encapsulation

Use CSS Modules for component styles.
