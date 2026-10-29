# Portable recipe format v1

The normative structural contract is [recipe.schema.json](../recipe.schema.json),
using JSON Schema Draft-07. This guide defines additional semantic constraints.
The document contains one recipe, ingredient and unit catalogues, and optional
references to other recipes. It does not contain accounts, credentials, publication
state, local database IDs, revision history or media binaries.

## Document-local references

Every ingredient, unit, step, entry, variant and recipe reference has a `key`.
Keys start with a lowercase ASCII letter, followed by lowercase letters, digits or
hyphens, up to 80 characters. Keys are unique within their entity collection;
entry keys are unique across every step of the recipe. They are independent of
existing Shadowcook UUIDs. Different entity collections may reuse the same key.

- `ingredients`: objects with `key`, authored `name`, optional `aliases` and `source`.
- `units`: objects with `key`, `name`, `symbol`, optional `conversion` and `source`.
- `recipe`: title, optional summary, category paths, metadata, diet and provenance,
  ordered steps and explicit variants.
- `recipeReferences`: optional objects with `key`, authored `title`, public HTTP(S)
  `url` and optional `source`.
- `$schema`: optional absolute URL of the schema resource, as supplied by the sharing
  manifest. It is metadata, not an instruction to fetch arbitrary external schemas.

Source catalogue names and authored text are retained. Category paths are suggestions,
for example `[["Main courses", "Soups"], ["Quick meals"]]`; their segments run from
root to leaf. They do not assert local category membership. An empty or omitted list
leaves category selection to a import review. Publication requires a category.

## Step entries

Each step has `key`, non-blank `instruction` and an `entries` array, which may be empty.
Keep instruction line breaks. Array order is the canonical step and entry order.

| `kind`       | Required fields besides `key` and `kind` | Optional fields                                    |
| ------------ | ---------------------------------------- | -------------------------------------------------- |
| `ingredient` | `ingredientKey`                          | `alias`, `amount`, `unitKey`, `isOptional`, `note` |
| `text`       | `text`                                   | `amount`, `unitKey`, `isOptional`, `note`          |
| `special`    | `specialKind`                            | `note`                                             |

`ingredientKey` must resolve to the document's ingredient catalogue. An `alias`
must occur in that ingredient's `aliases`; it retains the selected authored name.
`unitKey` must resolve to the unit catalogue. Omit unknown optional entry fields;
they do not accept `null`. Missing `isOptional` means false.

Use catalogue entries for real ingredients so future shopping-list aggregation and
matching retain ingredient identity. Use `text` for prepared components or other
free-text entries. Use [special entries](icons.md) for action/information pictograms.
Special entries cannot contain an ingredient, text, amount, unit or optional flag.

Entries render in the left-hand technical column. Keep all entry text and notes
strictly technical and compact: ingredient or component names, quantities, units,
short preparation states ("finely chopped"), temperatures ("180 °C"), durations
("20 min", ">= 12 Stunden") and other concise parameters ("low heat"). Full sentences,
preparation prose, explanations, tips and warnings belong in the step's `instruction`.
Do not move prose into `text` entries or `NO_ICON`, `INFO` or `IMPORTANT` notes.
Special entries may contain only their icon with no note. Keep warnings complete
in the instruction; a dedicated warning step may have an empty `entries` array or
an `IMPORTANT` marker without a note. Include such a step in every affected variant.

For example, use a `COOL` note of ">= 12 Stunden" beside the instruction
"Mindestens 12 Stunden gekühlt durchziehen lassen." The sidebar carries the compact
parameter; the instruction carries the complete action and context. This is an
authoring rule; the structural validator does not classify prose automatically.

Amounts are non-negative decimal strings such as `"2"` and `"0.5"`, with at most
12 integer digits and 12 fractional digits. Use a decimal point, no grouping separator,
fraction syntax, unit suffix or exponent. Avoid unnecessary trailing zeroes.
Structured `amount` and `unitKey` are authoritative. An entry's `note` must not
contradict, repeat or weaken its structured quantity. Do not add a second amount
or range in the same unit, or use "approximately" / "ca." to make a supplied exact
amount approximate. For `amount: "12"`, `unitKey: "g"` and cocoa, the note
"ungesüßt" is valid; "ungesüßt, ca. 10–15 g" is not. Likewise, for `120 g`
ladyfingers, use "passend zugeschnitten", not "ca., passend zugeschnitten".
Compatible preparation details and clearly labelled approximate equivalents in
another unit, such as "ca. 4 Stück, Größe L" beside a fixed weight of egg yolk,
may supplement the structured quantity; the structured weight remains authoritative.
If only a range or "to taste" is known, omit `amount` and put that information in
the note rather than inventing an exact amount. Include the unit with a range in
the note and omit `unitKey` when the complete quantity is expressed there.

## Units and matching

Unit names and symbols identify the authored unit; they do not prove equivalence.
If its definition is known, `conversion` includes all of `dimension`, `baseFactor`
and `baseOffset`. Factors and offsets are exact decimal strings with the same precision
limits as amounts; factors are positive and offsets may be negative.

| Dimension     | Base unit       |
| ------------- | --------------- |
| `MASS`        | gram            |
| `VOLUME`      | millilitre      |
| `COUNT`       | individual item |
| `TEMPERATURE` | degree Celsius  |

`baseAmount = amount × baseFactor + baseOffset`. Non-temperature offsets must be zero.
For example, a known US cup has volume factor `"236.5882365"` and offset `"0"`.
An unspecified cup or pinch has no conversion until its definition is established.
Do not infer mass from volume; ingredient-specific conversions are outside v1.
The importer will resolve each ingredient/unit key to a local entity and
offers existing matches or creation of a new entity. Known unit definitions must match
exactly; an unknown definition requires explicit selection. Unused catalogue declarations
do not create entries. This skill makes no catalogue writes.

## Variants

Every recipe has at least one variant. Each has `key`, authored `name`, URL `slug`,
`isDefault`, `isVisible` and non-empty `includedStepKeys`. Slugs are unique per recipe.
Exactly one variant is default; it is visible. Every included step key resolves to
one recipe step. Each list follows the recipe's global step order, with no duplicate
keys. There is no implicit inclusion, exclusion or inherited base variant.
Every step belongs to at least one variant. Shared steps are stored once.

## Recipe references

In an instruction, `{recipe:sauce}` refers to the document's `recipeReferences`
entry with key `sauce`. Every such token must resolve. Its URL is a known accessible
recipe deep link without access tokens; do not invent an ID or embed a private share
credential. Source Shadowcook UUID tokens must be converted to document-local references
when their target is known. If a private target has no safe link, describe the component
in plain text rather than leaking credentials or creating an unresolved reference.
These portable tokens require resolution during import; they are not existing
local recipe IDs and must not be posted directly to the current editor API.

## Metadata and provenance

Metadata fields match Shadowcook recipe content: `difficulty` (`EASY`, `MEDIUM`,
`DEMANDING`), integer `totalMinutes` and `activeMinutes`, total recipe `kcal`, positive
`servings`, and free-text `utensils`. Unknown fields are omitted or null. Active minutes
cannot exceed total minutes when both are supplied. Do not include calculated
`kcalPerServing` or system-maintained creation/publication timestamps.
Diet is `VEGAN`, `VEGETARIAN`, `OMNI`, or null/omitted for unclassified content.
Classify only when supported by the recipe's ingredients. Vegan and vegetarian labels
are rendered with leaf and egg icons; omnivorous and unclassified recipes have no diet icon.

An entity's optional `source` identifies its known source with `instanceUrl`,
`tenantPublicId` and `publicId`. UUIDs are source public IDs, never local database IDs.
Only an instance-owned unit may use a null `tenantPublicId`. `instanceUrl` is the
source instance's public HTTP(S) base URL without credentials, query or fragment.
Omit the entire source when it is unknown.

Optional `recipe.provenance` contains its recipe `source` and, when known,
`revisionPublicId` and `lineagePublicId`. Preserve known lineage when adapting/forking.
New recipes omit provenance. Document-local keys never become trusted global identity.
Origins in uploaded/generated documents are unverified claims; federation authentication
and access rights are separate. Federation mappings are scoped by receiving
cookbook and source instance/tenant/entity identity and reused across recipes.

## Semantic validation checklist

After schema validation, check:

1. Unique ingredient, unit, step, variant, recipe-reference and global entry keys;
   unique variant slugs.
2. All ingredient/unit/variant-step/recipe-token references resolve inside this document;
   selected ingredient aliases belong to the referenced ingredient.
3. Exactly one default variant, visible; included steps follow global step order;
   all steps occur in at least one variant.
4. Active duration does not exceed total duration when both are known.
5. Source URLs and recipe-reference URLs contain no credentials, query or fragment.
   No generated document contains AI-context access tokens or private sharing secrets.
6. Entry text and notes contain only compact technical data. Instructions contain
   all prose and complete warnings, including any dedicated warning steps.
7. Notes agree with structured quantities and do not repeat or weaken them with
   competing amounts, ranges or approximation qualifiers. A range-only quantity
   has no invented exact `amount`.

The bundled validator checks structural rules and the mechanically verifiable
semantic constraints. It cannot authenticate provenance, establish whether an amount
is correct, detect natural-language contradictions between notes and structured
quantities, or prove that an arbitrary text field contains no private information.

## Upload and draft import

Users can select a JSON file or paste JSON at `/{tenantSlug}/manage/recipes/import` in the
cookbook UI. Both inputs use the same server-side validation and catalogue review.
Each used ingredient and unit needs an explicit local selection; unique exact matches
may be suggested. Unknown unit definitions have no automatic selection. New catalogue
entries require the corresponding creation permissions. Additional variants require
variant creation permission. The import creates one draft and never publishes it.

The HTTP API accepts a `json` string at
`POST /cookbook/tenants/{tenantSlug}/recipe-imports/preview`. The commit endpoint is
`POST /cookbook/tenants/{tenantSlug}/recipe-imports`, with the original JSON, selected
recipe URL slug, category public IDs and ingredient/unit mappings. These endpoints
require ordinary cookbook permissions; AI-context reader credentials cannot use them.
Recipe references are retained as authored title-and-URL text. Source identities remain
unverified claims and do not activate federation or establish trusted persistent mappings.

The import limit is 1 MiB of UTF-8 recipe JSON, nesting depth 64, 500 ingredient
declarations, 200 unit declarations, 500 steps, 50 variants, 100 recipe references
and 5000 entries. Source identities within each catalogue must be unique.

The import UI is a wizard with Next, Previous and Finish controls. It presents an
informational recipe overview, editable URL/category/variant details, then assignment
tables. Empty variant-name inputs use the UI locale's default variant label. Existing
step memberships and variant slugs are retained. Searchable assignment boxes keep the
permitted new-entry choice first, then the original ingredient's suggestions above
the currently filtered catalogue entries. Selecting a new entry clears and disables
the alias checkbox.

For an existing ingredient mapping, optional `addAsAlias: true` explicitly adds that
document ingredient's original `name` as an alias of the selected local ingredient.
It requires `ingredient:update` and commits together with the recipe; equivalent
existing aliases are reused. The option applies only to existing ingredient mappings,
not to unit mappings or new-entry creation. The preview exposes
`permissions.canAddIngredientAliases`. An empty catalogue search returns up to 25
existing entries. Authored preparation notes are not ingredient aliases.
