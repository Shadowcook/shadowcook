export interface RecipeImportTranslation {
  wizard: {
    progress: string;
    step: string;
    next: string;
    previous: string;
    finish: string;
    overview: string;
    details: string;
    mapping: string;
    overviewSummary: string;
    variantHint: string;
    originalIngredient: string;
    originalUnit: string;
    assignment: string;
    addAsAlias: string;
    aliasLabel: string;
    aliasPermission: string;
    suggestions: string;
    existing: string;
    searchPlaceholder: string;
    mappingLabel: string;
    emptyIngredients: string;
    emptyUnits: string;
  };
  title: string;
  description: string;
  source: string;
  file: string;
  paste: string;
  chooseFile: string;
  json: string;
  sourceHint: string;
  dropHint: string;
  dropFile: string;
  selectedFile: string;
  validate: string;
  validating: string;
  review: string;
  reviewHint: string;
  back: string;
  submit: string;
  submitting: string;
  ingredientMapping: string;
  unitMapping: string;
  mappingHint: string;
  chooseMapping: string;
  createNew: string;
  name: string;
  symbol: string;
  search: string;
  searchLabel: string;
  searching: string;
  noMatches: string;
  unknownDefinition: string;
  variant: string;
  categoryHint: string;
  referenceHint: string;
  sourceLabel: string;
  unverified: string;
  definition: string;
  baseUnits: Record<'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE', string>;
  matches: Record<'EXACT' | 'ALIAS' | 'SIMILAR' | 'DEFINITION', string>;
  errors: Record<string, string>;
  issues: Record<
    'JSON' | 'SCHEMA' | 'DUPLICATE' | 'REFERENCE' | 'VARIANT' | 'DURATION' | 'URL' | 'LIMIT',
    string
  >;
}

export const recipeImportEnglish: RecipeImportTranslation = {
  wizard: {
    progress: 'Recipe import steps',
    step: 'Step {current} of {total}',
    next: 'Next',
    previous: 'Previous',
    finish: 'Finish',
    overview: 'Recipe overview',
    details: 'Recipe details',
    mapping: 'Catalogue assignments',
    overviewSummary: 'Steps: {steps} · Ingredients: {ingredients} · Variants: {variants}',
    variantHint:
      'An empty name uses “{defaultName}”. Setting an empty name or “{defaultName}” resets its URL name to “default”. You can edit each variant URL name.',
    originalIngredient: 'Original ingredient',
    originalUnit: 'Original unit',
    assignment: 'Assign to',
    addAsAlias: 'Add as alias',
    aliasLabel: 'Add “{name}” as an alias of the selected ingredient',
    aliasPermission: 'Adding aliases requires permission to edit ingredients.',
    suggestions: 'Suggestions for “{name}”',
    existing: 'Existing entries',
    searchPlaceholder: 'Search or select…',
    mappingLabel: 'Assignment for {name}',
    emptyIngredients: 'This recipe has no catalogue ingredients to assign.',
    emptyUnits: 'This recipe has no units to assign.',
  },
  title: 'Import recipe',
  description:
    'Upload a Shadowcook recipe JSON file or paste its contents. Review the recipe and catalogue matches before saving a new draft.',
  source: 'Recipe JSON',
  file: 'Upload a file',
  paste: 'Paste JSON',
  chooseFile: 'Choose a JSON file',
  json: 'JSON contents',
  sourceHint: 'One recipe in Shadowcook recipe format v1, up to 1 MiB.',
  dropHint: 'You can also drop a JSON file anywhere on this page to check it.',
  dropFile: 'Drop the JSON file to check the recipe',
  selectedFile: 'Selected file: {name}',
  validate: 'Check recipe',
  validating: 'Checking recipe…',
  review: 'Review import',
  reviewHint:
    'Confirm the ingredient and unit matches. New entries and the recipe will be saved together as a draft.',
  back: 'Change JSON',
  submit: 'Import as draft',
  submitting: 'Importing…',
  ingredientMapping: 'Match ingredients',
  unitMapping: 'Match units',
  mappingHint:
    'Choose an existing entry or create a new one. Each choice applies everywhere this entry is used in the recipe.',
  chooseMapping: 'Choose a match…',
  createNew: 'Create a new entry',
  name: 'Name of the new entry',
  symbol: 'Unit symbol',
  search: 'Search',
  searchLabel: 'Search existing entries',
  searching: 'Searching…',
  noMatches: 'No matching entries found.',
  unknownDefinition:
    'The source does not define this unit. Check its meaning before choosing an existing unit.',
  variant: 'Recipe variant',
  categoryHint:
    'Select categories for the imported recipe. Categories can also be assigned later in the editor.',
  referenceHint: 'References to other recipes are retained as titles and URLs in the instructions.',
  sourceLabel: 'Recipe source',
  unverified: 'Source information has not been verified.',
  definition: '1 {symbol} = {amount} {unit}',
  baseUnits: { MASS: 'g', VOLUME: 'ml', COUNT: 'item(s)', TEMPERATURE: '°C' },
  matches: {
    EXACT: 'Same name',
    ALIAS: 'Matching alias',
    SIMILAR: 'Similar name',
    DEFINITION: 'Same unit definition',
  },
  errors: {
    empty: 'Select a file or paste the recipe JSON first.',
    file: 'The selected file could not be read.',
    jsonFile: 'Choose a JSON file (.json).',
    singleFile: 'Drop one JSON file at a time.',
    large: 'The recipe JSON must not exceed 1 MiB.',
    incomplete:
      'Choose a match or a new entry for every ingredient and unit, and enter a recipe title and valid, unique recipe and variant URL names.',
    INVALID_RECIPE_DOCUMENT: 'The recipe JSON is invalid. Review the details below.',
    INVALID_RECIPE_IMPORT: 'The import settings are invalid. Check your selections.',
    IMPORT_MAPPING_INVALID: 'A selected entry no longer exists. Check the mappings again.',
    IMPORT_CATALOGUE_CONFLICT:
      'An ingredient name, alias or unit already exists. Choose the existing entry or change the name and symbol of the new entry.',
    IMPORT_UNIT_MISMATCH:
      'A selected unit has a different definition. Choose an equivalent unit or create a new one.',
    IMPORT_CREATE_PERMISSION_REQUIRED:
      'You do not have permission to create one of the required catalogue entries or additional variants.',
    IMPORT_ALIAS_PERMISSION_REQUIRED:
      'You do not have permission to add aliases to existing ingredients.',
    RECIPE_IMPORT_CONFLICT:
      'The recipe URL name or a new catalogue entry already exists. Check your selections.',
    INVALID_RECIPE_CATEGORY:
      'A selected category is no longer available. Select the categories again.',
    RECIPE_IMPORT_TOO_LARGE: 'The recipe JSON must not exceed 1 MiB.',
  },
  issues: {
    JSON: 'Invalid JSON syntax.',
    SCHEMA: 'This value does not match the recipe format.',
    DUPLICATE: 'A property or identifier occurs more than once.',
    REFERENCE: 'A reference or ingredient alias cannot be resolved.',
    VARIANT: 'Check the default variant, included steps and their order.',
    DURATION: 'Active duration exceeds total duration.',
    URL: 'Source and recipe URLs must not contain credentials, queries or fragments.',
    LIMIT: 'The document exceeds the supported size or complexity.',
  },
};

export const recipeImportGerman: RecipeImportTranslation = {
  wizard: {
    progress: 'Schritte des Rezeptimports',
    step: 'Schritt {current} von {total}',
    next: 'Weiter',
    previous: 'Zurück',
    finish: 'Fertigstellen',
    overview: 'Rezeptübersicht',
    details: 'Rezept-Kopfdaten',
    mapping: 'Katalogzuordnungen',
    overviewSummary: 'Schritte: {steps} · Zutaten: {ingredients} · Varianten: {variants}',
    variantHint:
      'Ein leerer Name wird durch „{defaultName}“ ersetzt. Ein leerer Name oder „{defaultName}“ setzt den URL-Namen auf „default“. Du kannst den URL-Namen jeder Variante bearbeiten.',
    originalIngredient: 'Originalzutat',
    originalUnit: 'Originaleinheit',
    assignment: 'Zuordnung',
    addAsAlias: 'Als Alias hinzufügen',
    aliasLabel: '„{name}“ als Alias der ausgewählten Zutat hinzufügen',
    aliasPermission:
      'Zum Hinzufügen von Aliasen ist die Berechtigung zum Bearbeiten von Zutaten erforderlich.',
    suggestions: 'Vorschläge für „{name}“',
    existing: 'Bestehende Einträge',
    searchPlaceholder: 'Suchen oder auswählen…',
    mappingLabel: 'Zuordnung für {name}',
    emptyIngredients: 'Dieses Rezept enthält keine zuzuordnenden Katalogzutaten.',
    emptyUnits: 'Dieses Rezept enthält keine zuzuordnenden Einheiten.',
  },
  title: 'Rezept importieren',
  description:
    'Lade eine Shadowcook-Rezeptdatei im JSON-Format hoch oder füge ihren Inhalt ein. Prüfe das Rezept und die Zuordnungen, bevor du einen neuen Entwurf speicherst.',
  source: 'Rezept-JSON',
  file: 'Datei hochladen',
  paste: 'JSON einfügen',
  chooseFile: 'JSON-Datei auswählen',
  json: 'JSON-Inhalt',
  sourceHint: 'Ein Rezept im Shadowcook-Rezeptformat v1, bis zu 1 MiB.',
  dropHint: 'Du kannst auch eine JSON-Datei auf diese Seite ziehen, um sie zu prüfen.',
  dropFile: 'JSON-Datei ablegen, um das Rezept zu prüfen',
  selectedFile: 'Ausgewählte Datei: {name}',
  validate: 'Rezept prüfen',
  validating: 'Rezept wird geprüft…',
  review: 'Import prüfen',
  reviewHint:
    'Bestätige die Zuordnung der Zutaten und Einheiten. Neue Einträge und das Rezept werden gemeinsam als Entwurf gespeichert.',
  back: 'JSON ändern',
  submit: 'Als Entwurf importieren',
  submitting: 'Wird importiert…',
  ingredientMapping: 'Zutaten zuordnen',
  unitMapping: 'Einheiten zuordnen',
  mappingHint:
    'Wähle einen bestehenden Eintrag oder lege einen neuen an. Die Auswahl gilt für alle Verwendungen dieses Eintrags im Rezept.',
  chooseMapping: 'Zuordnung auswählen…',
  createNew: 'Neuen Eintrag anlegen',
  name: 'Name des neuen Eintrags',
  symbol: 'Einheitensymbol',
  search: 'Suchen',
  searchLabel: 'Bestehende Einträge suchen',
  searching: 'Wird gesucht…',
  noMatches: 'Keine passenden Einträge gefunden.',
  unknownDefinition:
    'Die Quelle definiert diese Einheit nicht. Prüfe ihre Bedeutung, bevor du eine bestehende Einheit auswählst.',
  variant: 'Rezeptvariante',
  categoryHint:
    'Wähle Kategorien für das importierte Rezept. Du kannst sie auch später im Editor zuweisen.',
  referenceHint:
    'Verweise auf andere Rezepte bleiben als Titel und URLs in den Anweisungen erhalten.',
  sourceLabel: 'Rezeptquelle',
  unverified: 'Die Herkunftsangaben wurden nicht verifiziert.',
  definition: '1 {symbol} = {amount} {unit}',
  baseUnits: { MASS: 'g', VOLUME: 'ml', COUNT: 'Stück', TEMPERATURE: '°C' },
  matches: {
    EXACT: 'Gleicher Name',
    ALIAS: 'Passender Alias',
    SIMILAR: 'Ähnlicher Name',
    DEFINITION: 'Gleiche Einheitendefinition',
  },
  errors: {
    empty: 'Wähle zuerst eine Datei aus oder füge das Rezept-JSON ein.',
    file: 'Die ausgewählte Datei konnte nicht gelesen werden.',
    jsonFile: 'Wähle eine JSON-Datei (.json) aus.',
    singleFile: 'Lege jeweils nur eine JSON-Datei ab.',
    large: 'Das Rezept-JSON darf höchstens 1 MiB groß sein.',
    incomplete:
      'Wähle für jede Zutat und Einheit einen bestehenden oder neuen Eintrag und gib einen Rezepttitel sowie gültige, eindeutige URL-Namen für das Rezept und seine Varianten ein.',
    INVALID_RECIPE_DOCUMENT: 'Das Rezept-JSON ist ungültig. Prüfe die Hinweise unten.',
    INVALID_RECIPE_IMPORT: 'Die Importeinstellungen sind ungültig. Prüfe deine Auswahl.',
    IMPORT_MAPPING_INVALID:
      'Ein ausgewählter Eintrag existiert nicht mehr. Prüfe die Zuordnungen erneut.',
    IMPORT_CATALOGUE_CONFLICT:
      'Ein Zutatenname, Alias oder eine Einheit existiert bereits. Wähle den bestehenden Eintrag oder ändere Name und Symbol des neuen Eintrags.',
    IMPORT_UNIT_MISMATCH:
      'Eine ausgewählte Einheit hat eine andere Definition. Wähle eine gleichwertige Einheit oder lege eine neue an.',
    IMPORT_CREATE_PERMISSION_REQUIRED:
      'Dir fehlt die Berechtigung zum Anlegen eines benötigten Katalogeintrags oder zusätzlicher Varianten.',
    IMPORT_ALIAS_PERMISSION_REQUIRED:
      'Dir fehlt die Berechtigung zum Hinzufügen von Aliasen zu bestehenden Zutaten.',
    RECIPE_IMPORT_CONFLICT:
      'Der Rezept-URL-Name oder ein neuer Katalogeintrag existiert bereits. Prüfe deine Auswahl.',
    INVALID_RECIPE_CATEGORY:
      'Eine ausgewählte Kategorie ist nicht mehr verfügbar. Wähle die Kategorien erneut aus.',
    RECIPE_IMPORT_TOO_LARGE: 'Das Rezept-JSON darf höchstens 1 MiB groß sein.',
  },
  issues: {
    JSON: 'Ungültige JSON-Syntax.',
    SCHEMA: 'Dieser Wert entspricht nicht dem Rezeptformat.',
    DUPLICATE: 'Ein Feld oder Bezeichner kommt mehrfach vor.',
    REFERENCE: 'Ein Verweis oder Zutatenalias kann nicht zugeordnet werden.',
    VARIANT: 'Prüfe die Standardvariante, die enthaltenen Schritte und ihre Reihenfolge.',
    DURATION: 'Die aktive Dauer überschreitet die Gesamtdauer.',
    URL: 'Quell- und Rezept-URLs dürfen keine Zugangsdaten, Abfragen oder Fragmente enthalten.',
    LIMIT: 'Das Dokument überschreitet die erlaubte Größe oder Komplexität.',
  },
};
