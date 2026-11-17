---
name: shadowcook-recipe
description: Create or adapt a recipe as portable Shadowcook recipe JSON, including step ingredients, special-entry icons, variants and known provenance. Use when a user requests a Shadowcook-compatible recipe file or supplies an AI-sharing context for recipe development.
---

# Shadowcook recipe authoring

Deliver one UTF-8 `.shadowcook.json` file containing one recipe in the
`shadowcook-recipe` format, `formatVersion: 1`.

Read [the format guide](references/format.md) and
[the JSON Schema](recipe.schema.json) before composing the document. Start with
[the simple recipe](examples/simple.json). For shared steps, alternate preparations
or special entries, consult [the variant example](examples/variants.json) and
[the icon guide](references/icons.md).

## Work with the user's recipe

- Preserve the language of authored titles, ingredient names, instructions, notes,
  category names and variant names. English field names and enum values are protocol
  identifiers, not a request to translate recipe content.
- Keep ingredients beside the step that uses them. Catalogue ingredients are declared
  once and referenced by document-local keys. Preparation states such as "melted"
  belong in entry notes. Use text entries for prepared components and special entries
  for the supported action/information icons.
- Distinguish original ingredients from components produced within the recipe.
  An original ingredient is brought into the preparation, including an explicitly
  purchased ready-made product; a prepared component is made from one or more
  ingredients or earlier components. Declare original ingredients as `ingredient`
  entries, and reference components made within the recipe as `text` entries in
  subsequent steps. Do not add those components as separate catalogue ingredients
  or count their source ingredients again. Whether something is an ingredient or a
  component depends on its role in this recipe, not its name: purchased roux is an
  ingredient; roux prepared from butter and flour is a component.
- Choose ingredient units that are natural for the product and useful when shopping
  and cooking, without converting quantities to package sizes. Use count units for
  countable items such as whole eggs (including size when relevant), and mass units
  for ingredients normally weighed, such as butter, flour, sugar and liquids.
  For example, specify `4 Stück Eier (Größe L)` rather than separate purchases of
  `80 g Eigelb` and `105 g Eiweiß` when the yolks and whites come from those eggs;
  specify `360 g Butter`, not a number of butter packages or vague "pieces".
  Do not replace a meaningful mass requirement with an approximate item count.
- Describe the transformation and allocation of prepared components in the step's
  `instruction`. For example, separate the eggs and allocate the required yolks and
  whites using quantities in their technical entries, then refer to those components
  as `text` entries in later steps. Likewise, introduce butter and flour as
  `ingredient` entries when making a roux, then refer to the prepared roux as a
  component when adding it to a sauce. If a component's exact processed mass is
  essential, put the required amount in a technical `text` entry for that component;
  instruct the cook to weigh or separate the specified portion without repeating
  the amount in prose. Ensure that the original ingredients supply enough material.
  Do not presume that a component's final mass equals the sum of its inputs:
  evaporation, draining, trimming and other processing can change its mass. When
  the entire prepared component is used, say so rather than inventing its mass.
- Keep the left-hand technical column strictly compact: ingredient/component names,
  quantities, units, short preparation states, temperatures, durations and technical
  parameters only. Entry `text` and `note` are not places for prose, explanations,
  full-sentence instructions or warnings. For example, a `COOL` note may say
  ">= 12 Stunden"; the matching `instruction` says "Abgedeckt im Kühlschrank
  durchziehen lassen." Put complete warnings in `instruction`, in a separate step
  when useful. Preserve their full meaning; do not truncate them to fit the column.
  An `IMPORTANT`, `INFO` or `NO_ICON` entry does not change this rule. Special entries
  may omit `note` when the icon alone supplies the technical marker.
- **Separate active preparation from distinct passive phases.** Resting, chilling,
  marinating, proofing, cooling and other waiting phases with their own duration or
  conditions should be separate steps from the preceding handling. Their entries
  reference the previously prepared component as `text` (do not re-list its source
  ingredients) and use suitable technical markers such as `WAIT` or `COOL`. Keep
  tightly connected active operations together; do not split every physical action
  into its own step. A controlled cooking phase that requires monitoring or handling
  may remain a coherent cooking step. See [the format guide](references/format.md).
- **Single source of truth:** when a technical value appears in a step's structured
  entries, never repeat it in the step's `instruction`, nor in another prose step
  that refers to the same parameter. This includes ingredient amounts and units,
  durations, temperatures, dimensions, equipment settings and other adjustable
  parameters. Technical entries say what/how much/at what setting; prose says what
  to do, how and why, describes the sensory target and gives complete warnings.
  A change to a technical entry must not require editing prose to prevent a
  contradiction. If an essential technical detail cannot be represented meaningfully
  by an entry, put it in `instruction` once rather than omitting it. Do not duplicate
  it in an entry. See the examples and [the format guide](references/format.md).
- Order steps and entries through their arrays. Variants explicitly list included
  step keys; exactly one variant is default and it must be visible.
- Use decimal strings for amounts and unit conversions. Omit unknown amounts and
  conversions. Do not guess whether an unspecified cup means a US cup or another unit.
- Treat structured `amount` and `unitKey` as authoritative. Notes must not contradict,
  repeat or weaken that quantity with another amount, a range or "approximately" in
  the same unit. For `12 g` cocoa, use a note such as "ungesüßt", never
  "ungesüßt, ca. 10–15 g". If only a range is known, omit the structured amount
  instead of inventing an exact value; see the format guide's quantity rules.
- Prefer a deliberate, reproducible quantity whenever the recipe allows one to be established.
  A quantity does not need to be universally optimal to be authoritative for this recipe.
  Omit it only when it cannot be meaningfully determined in advance.
- Preserve known source identities and lineage when adapting a sourced recipe.
  Invent only document-local keys. Unknown origin, UUIDs, nutrition and other metadata
  stay absent. Source claims do not establish federation trust or grant access.

## Use an AI-sharing context

When the user supplies a Shadowcook AI-context link, exchange it once and retain the
returned manifest for the session. Follow `requestInstructions`, `authentication`
and `restrictions` for reader requests. Use `endpoints.*.url` as absolute templates;
they include any public API prefix. Read only the recipe context needed for the task.

Reader summaries may omit full variant membership or unit definitions. Preserve what
is known, ask for missing variant information when it is needed, and leave unknown
unit conversions absent. Never assume every variant includes the default variant's steps.

Public skill files need no credentials. Never attach context tokens to their URLs,
recipe links, the generated JSON, or requests to another service. Fetching a referenced
recipe requires its own permitted reader access. Keep the context read-only.

If this skill was opened through its public URL, resolve relative links against that
URL. The manifest's `recipeAuthoring.downloadUrl` provides the complete skill ZIP.
When using an unpacked skill, resources are relative to this `SKILL.md`.

## Validate and deliver

Validate both the schema and the semantic rules in the format guide, including a
manual check that notes agree with structured quantities, original ingredients
use appropriate units, and prepared components are not counted again as
purchased ingredients. In addition, review step granularity: active preparation
must not swallow an independent passive waiting phase. Review every step for
repeated amounts, times, temperatures or other technical parameters across the
left-hand entries and prose. A bundled validator checks structural and
mechanically verifiable semantic constraints with Python 3.10 or newer:

```sh
python3 -m pip install -r scripts/requirements.txt
python3 scripts/validate_recipe.py /path/to/recipe.shadowcook.json
```

The bundled validator does not automatically enforce these editorial rules.
Use an available environment with these dependencies, or install them in an isolated
environment. If the script cannot run, use another Draft-07 JSON Schema validator
and check the semantic rules explicitly. State when validation was not performed.

Return the JSON as a downloadable file when supported, otherwise as one JSON code
block. Keep explanations outside the JSON. Users can upload the file or paste its contents at `/{tenantSlug}/manage/recipes/import`,
follow the import wizard through a read-only overview, URL/category/variant details,
and ingredient/unit assignment tables, then finish to save a new draft. Searchable
selection boxes show the permitted new-entry choice first, followed by original-ingredient
suggestions and filtered existing entries. Selecting a new entry clears and disables
the alias checkbox.
Users may explicitly add the original ingredient name as an alias of a selected
existing ingredient when they have ingredient-edit permission. The UI also supports
explicitly creating new catalogue entries when permitted. AI-sharing contexts remain read-only;
do not claim to have saved or published a recipe when only delivering the JSON file.
