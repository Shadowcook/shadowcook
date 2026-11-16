export interface InspectionTranslation {
  search: string;
  sections: string;
  recipeList: string;
  revisions: string;
  emptyRevisions: string;
  results: string;
  noResults: string;
  previous: string;
  next: string;
  page: string;
  pagination: string;
  retry: string;
  back: string;
  overview: string;
  actions: string;
  actionsHelp: string;
  active: string;
  readOnly: string;
  emptyRecipes: string;
  emptyMembers: string;
  emptyReports: string;
  selectRevision: string;
  revision: string;
  joined: string;
  steps: string;
  title: string;
  explanation: string;
  reason: string;
  report: string;
  enter: string;
  end: string;
  error: string;
  invalidPurpose: string;
  denied: string;
  missing: string;
  recipes: string;
  members: string;
  reports: string;
  owner: string;
  created: string;
  updated: string;
  variant: string;
  image: string;
  optional: string;
  statuses: Record<string, string>;
  metadata: Record<string, string>;
}
export const inspectionEnglish: InspectionTranslation = {
  search: 'Search by name or ID',
  sections: 'Inspection sections',
  recipeList: 'Recipes',
  revisions: 'Recipe revisions',
  emptyRevisions: 'No revisions for this recipe.',
  results: 'Results',
  noResults: 'No matching results.',
  previous: 'Previous',
  next: 'Next',
  page: 'Page',
  pagination: 'Result pages',
  retry: 'Try again',
  back: 'Cookbook administration',
  overview: 'Cookbook overview',
  actions: 'Cookbook actions',
  actionsHelp: 'Changes require a separate reason and confirmation.',
  active: 'Active',
  readOnly: 'Read-only · Access is audited',
  emptyRecipes: 'No recipes in this cookbook.',
  emptyMembers: 'No members in this cookbook.',
  emptyReports: 'No reports for this cookbook.',
  selectRevision: 'Select a revision to inspect its content.',
  revision: 'Revision',
  joined: 'Joined',
  steps: 'Preparation',
  title: 'Administrative inspection',
  explanation:
    'Private content is inspected read-only for a legitimate administrative purpose. Each access is audited. Enter a reason before continuing.',
  reason: 'Investigation purpose',
  report: 'Related report UUID (optional)',
  enter: 'Inspect',
  end: 'End inspection',
  error: 'Inspection failed. Try again.',
  invalidPurpose: 'Enter a reason of 1–2,000 characters and an existing report UUID if supplied.',
  denied:
    'An active administrator session is required. Complete any required password or cookbook identity changes first.',
  missing: 'The requested inspection resource is unavailable.',
  recipes: 'Recipes and revisions',
  members: 'Members and roles',
  reports: 'Reports',
  owner: 'Canonical owner',
  created: 'Created',
  updated: 'Updated',
  variant: 'Variant',
  image: 'Inspected recipe cover',
  optional: 'Optional',
  statuses: {
    NO_ICON: '',
    REMOVE: 'Remove',
    ADD: 'Add',
    INFO: 'Information',
    IMPORTANT: 'Important',
    COOK: 'Cook',
    COOL: 'Cool',
    HEAT: 'Heat',
    WAIT: 'Wait',
    WORK_STEP: 'Work step',
    Owner: 'Owner',
    Editor: 'Editor',
    Viewer: 'Viewer',
    DRAFT: 'Draft',
    PUBLISHED: 'Published',
    ARCHIVED: 'Archived',
    OPEN: 'Open',
    UNDER_INVESTIGATION: 'Under investigation',
    CLOSED: 'Closed',
    deleted: 'In trash',
    EASY: 'Easy',
    MEDIUM: 'Medium',
    DEMANDING: 'Demanding',
    VEGAN: 'Vegan',
    VEGETARIAN: 'Vegetarian',
    OMNI: 'Omnivorous',
  },
  metadata: {
    difficulty: 'Difficulty',
    totalMinutes: 'Total minutes',
    activeMinutes: 'Active minutes',
    kcal: 'Calories (kcal)',
    servings: 'Servings',
    utensils: 'Utensils',
    diet: 'Diet',
  },
};
export const inspectionGerman: InspectionTranslation = {
  search: 'Nach Name oder ID suchen',
  sections: 'Bereiche der Einsicht',
  recipeList: 'Rezepte',
  revisions: 'Rezeptversionen',
  emptyRevisions: 'Keine Versionen für dieses Rezept.',
  results: 'Ergebnisse',
  noResults: 'Keine passenden Ergebnisse.',
  previous: 'Zurück',
  next: 'Weiter',
  page: 'Seite',
  pagination: 'Ergebnisseiten',
  retry: 'Erneut versuchen',
  back: 'Kochbuchverwaltung',
  overview: 'Kochbuchübersicht',
  actions: 'Kochbuchaktionen',
  actionsHelp: 'Änderungen erfordern eine eigene Begründung und Bestätigung.',
  active: 'Aktiv',
  readOnly: 'Schreibgeschützt · Zugriffe werden protokolliert',
  emptyRecipes: 'Keine Rezepte in diesem Kochbuch.',
  emptyMembers: 'Keine Mitglieder in diesem Kochbuch.',
  emptyReports: 'Keine Meldungen zu diesem Kochbuch.',
  selectRevision: 'Wähle eine Version aus, um ihren Inhalt einzusehen.',
  revision: 'Version',
  joined: 'Beigetreten',
  steps: 'Zubereitung',
  title: 'Administrative Einsicht',
  explanation:
    'Private Inhalte werden für einen berechtigten administrativen Zweck schreibgeschützt eingesehen. Jeder Zugriff wird protokolliert. Gib vor dem Fortfahren eine Begründung an.',
  reason: 'Untersuchungszweck',
  report: 'Zugehörige Meldungs-UUID (optional)',
  enter: 'Einsehen',
  end: 'Einsicht beenden',
  error: 'Einsicht fehlgeschlagen. Versuche es erneut.',
  invalidPurpose:
    'Gib eine Begründung mit 1–2.000 Zeichen und gegebenenfalls die UUID einer bestehenden Meldung an.',
  denied:
    'Eine aktive Administratorsitzung ist erforderlich. Schließe zunächst erforderliche Passwort- oder Kochbuch-Identitätsänderungen ab.',
  missing: 'Die angeforderten Inhalte sind für die Einsicht nicht verfügbar.',
  recipes: 'Rezepte und Rezeptstände',
  members: 'Mitglieder und Rollen',
  reports: 'Meldungen',
  owner: 'Kanonischer Eigentümer',
  created: 'Erstellt',
  updated: 'Aktualisiert',
  variant: 'Variante',
  image: 'Eingesehenes Rezeptbild',
  optional: 'Optional',
  statuses: {
    NO_ICON: '',
    REMOVE: 'Entfernen',
    ADD: 'Hinzufügen',
    INFO: 'Information',
    IMPORTANT: 'Wichtig',
    COOK: 'Garen',
    COOL: 'Kühlen',
    HEAT: 'Erhitzen',
    WAIT: 'Warten',
    WORK_STEP: 'Arbeitsschritt',
    Owner: 'Eigentümer',
    Editor: 'Bearbeiter',
    Viewer: 'Leser',
    DRAFT: 'Entwurf',
    PUBLISHED: 'Veröffentlicht',
    ARCHIVED: 'Archiviert',
    OPEN: 'Offen',
    UNDER_INVESTIGATION: 'In Untersuchung',
    CLOSED: 'Geschlossen',
    deleted: 'Im Papierkorb',
    EASY: 'Einfach',
    MEDIUM: 'Mittel',
    DEMANDING: 'Anspruchsvoll',
    VEGAN: 'Vegan',
    VEGETARIAN: 'Vegetarisch',
    OMNI: 'Mischkost',
  },
  metadata: {
    difficulty: 'Schwierigkeit',
    totalMinutes: 'Gesamtminuten',
    activeMinutes: 'Aktive Minuten',
    kcal: 'Kalorien (kcal)',
    servings: 'Portionen',
    utensils: 'Utensilien',
    diet: 'Ernährungsweise',
  },
};
