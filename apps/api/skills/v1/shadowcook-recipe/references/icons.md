# Recipe pictograms

Use semantic `specialKind` values, never SVG, Font Awesome names or arbitrary icon URLs
in recipe JSON. Shadowcook selects the pictogram. These entries are part of a step's
`entries` array with `kind: "special"`, a unique `key` and optional authored `note`.

| `specialKind` | Current silhouette | Use                                                |
| ------------- | ------------------ | -------------------------------------------------- |
| `NO_ICON`     | None               | A compact technical parameter without a pictogram  |
| `REMOVE`      | Minus              | Remove something from a bowl, pan or preparation   |
| `ADD`         | Plus               | Add something during preparation                   |
| `INFO`        | Information circle | Mark information explained in the step instruction |
| `IMPORTANT`   | Warning triangle   | Mark a warning written in the step instruction     |
| `COOK`        | Spoon              | Cooking, simmering or a cooking phase              |
| `COOL`        | Snowflake          | Cool or chill                                      |
| `HEAT`        | Burner             | Heat or preheat                                    |
| `WAIT`        | Clock              | Rest, wait, marinate or allow to stand             |
| `WORK_STEP`   | Tools              | A general preparation action                       |

```json
{
  "key": "rest-dough",
  "kind": "special",
  "specialKind": "WAIT",
  "note": "30 min"
}
```

A special entry has no `ingredientKey`, `text`, `amount`, `unitKey` or `isOptional`.
Use its note only for a compact technical parameter, such as "180 °C", "low heat"
or ">= 12 Stunden". Put actions and context in the step instruction: for example,
"Cover and rest for 30 minutes." or "Mindestens 12 Stunden gekühlt durchziehen lassen."
Never put prose, explanations, tips or full warnings in the left-hand technical
column, including `INFO`, `IMPORTANT` and `NO_ICON` notes. Omit a note when the icon
alone is sufficient. Keep the complete warning in the instruction, optionally in
its own step:

```json
{
  "key": "hot-splashes",
  "instruction": "Beim Pürieren auf heiße Spritzer achten.",
  "entries": [
    {
      "key": "hot-splashes-important",
      "kind": "special",
      "specialKind": "IMPORTANT"
    }
  ]
}
```

Warnings must retain their full meaning when moved into instructions. Do not
shorten or discard safety information to fit a note. A separate warning step must
belong to every variant to which the warning applies.
Normal ingredient rows remain ingredient entries even when an adjacent special row
describes an action involving them. An `ADD` row does not replace the ingredient usage.

Diet pictograms are separate recipe-level classifications: `VEGAN` uses a leaf,
`VEGETARIAN` an egg. `OMNI` and unclassified content show no diet icon. Diet is never
specified through a special entry. Other UI icons are not recipe content.
