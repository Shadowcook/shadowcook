export interface ModerationTranslation {
  block: string;
  unblock: string;
  reason: string;
  report: string;
  explanation: string;
  invalid: string;
  error: string;
  blocked: string;
  cookbook: string;
  recipeNotification: string;
  cookbookNotification: string;
  userReason: string;
  userReasonHelp: string;
  invalidUserReason: string;
  liftNotification: string;
  optionalUserReason: string;
}
export const moderationEnglish: ModerationTranslation = {
  block: 'Restrict access',
  unblock: 'Lift restriction',
  reason: 'Administrative reason',
  userReason: 'Reason given to user',
  optionalUserReason: 'Reason given to user (optional)',
  liftNotification:
    'Lifting this restriction sends an email to the cookbook owner. Other access restrictions remain in effect.',
  userReasonHelp:
    'This explanation is included in the email to the cookbook owner. Do not include private investigation notes.',
  invalidUserReason: 'Enter a reason for the user of 1–2,000 characters.',
  report: 'Related report UUID (optional)',
  explanation:
    'This restriction prevents ordinary access, including by owners and editors. Content and history are preserved. Lifting it preserves publication, trash and any independent cookbook identity lock.',
  invalid: 'Enter a reason of 1–2,000 characters and a valid report UUID if supplied.',
  error: 'The moderation change failed. Reload the view and try again.',
  blocked: 'Administratively restricted',
  cookbook: 'Cookbook moderation',
  recipeNotification:
    'Restricting a recipe sends an email to the cookbook owner. The administrative reason stays private.',
  cookbookNotification:
    'Restricting a cookbook sends an email to its owner. The administrative reason stays private.',
};
export const moderationGerman: ModerationTranslation = {
  block: 'Zugriff sperren',
  unblock: 'Sperre aufheben',
  reason: 'Administrative Begründung',
  userReason: 'Begründung für den Benutzer',
  optionalUserReason: 'Begründung für den Benutzer (optional)',
  liftNotification:
    'Beim Aufheben dieser Sperre wird der Kochbuchbesitzer per E-Mail informiert. Andere Zugriffsbeschränkungen bleiben bestehen.',
  userReasonHelp:
    'Diese Erklärung steht in der E-Mail an den Kochbuchbesitzer. Gib keine vertraulichen Ermittlungsnotizen ein.',
  invalidUserReason: 'Gib eine Begründung für den Benutzer mit 1–2.000 Zeichen an.',
  report: 'Zugehörige Meldungs-UUID (optional)',
  explanation:
    'Diese Sperre verhindert normale Zugriffe, auch für Eigentümer und Bearbeiter. Inhalte und Historie bleiben erhalten. Beim Aufheben bleiben Veröffentlichungszustand, Papierkorb und eine unabhängige Kochbuch-Identitätssperre bestehen.',
  invalid:
    'Gib eine Begründung mit 1–2.000 Zeichen und gegebenenfalls eine gültige Meldungs-UUID an.',
  error: 'Die Moderationsänderung ist fehlgeschlagen. Lade die Ansicht neu und versuche es erneut.',
  blocked: 'Administrativ gesperrt',
  cookbook: 'Kochbuchmoderation',
  recipeNotification:
    'Beim Sperren eines Rezepts wird der Kochbuchbesitzer per E-Mail informiert. Die administrative Begründung bleibt vertraulich.',
  cookbookNotification:
    'Beim Sperren eines Kochbuchs wird der Besitzer per E-Mail informiert. Die administrative Begründung bleibt vertraulich.',
};
