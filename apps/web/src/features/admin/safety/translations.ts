export interface SafetyTranslation {
  invalidProof: string;
  cooldown: string;
  emailUnavailable: string;
  recoveryDisabled: string;
  mediaScope: string;
  deletion: string;
  review: string;
  reason: string;
  confirmation: string;
  preservation: string;
  irreversible: string;
  stale: string;
  failure: string;
  lastAdmin: string;
  ownership: string;
  proof: string;
  recovery: string;
  email: string;
  recoveryPending: string;
  recoveryConfirmed: string;
  recoveryConfirm: string;
  verified: string;
  sent: string;
  failedMail: string;
  complete: string;
  accountScope: string;
  accountDelete: string;
  accountDisable: string;
  accountEnable: string;
  invalid: string;
  invalidUserReason: string;
  invalidAdministrativeReason: string;
  preservationRequired: string;
  invalidConfirmation: string;
  deletionNotification: string;
  counts: Record<string, string>;
}
export const safetyEnglish: SafetyTranslation = {
  invalidProof:
    'This recovery link is invalid, expired or already used. Ask an administrator for a new link.',
  cooldown: 'Wait one minute before requesting another verification message.',
  emailUnavailable: 'That email address is already assigned or cannot be used.',
  recoveryDisabled:
    'The account must be activated through the reviewed administration process before email recovery.',
  mediaScope:
    'Media are referenced from another cookbook. Review those references before deleting.',

  deletion: 'Permanently delete',
  invalidUserReason: 'The reason given to the user must contain at most 2,000 characters.',
  invalidAdministrativeReason: 'Enter an administrative reason of 1–2,000 characters.',
  preservationRequired:
    'Select the checkbox to confirm that you reviewed preservation obligations and investigation needs before deleting.',
  invalidConfirmation: 'Enter the exact target UUID to confirm permanent deletion.',
  deletionNotification:
    'After permanent deletion, the cookbook owner is notified by email. The administrative reason stays private.',
  review: 'Review deletion scope',
  reason: 'Administrative reason and verification performed',
  confirmation: 'Type the target UUID to confirm',
  preservation:
    'I reviewed preservation obligations and investigation needs; deletion may proceed.',
  irreversible:
    'Permanent deletion removes live content, history, shares and unused media. Recipe deletion preserves cookbook memberships; cookbook deletion removes memberships, not accounts. Existing backups and downloads remain. Restrict access if investigation or preservation is still needed.',
  stale: 'The deletion scope changed. Review it again before deleting.',
  failure: 'The action failed. Reload the view before retrying.',
  lastAdmin: 'This action would remove the last usable administrator.',
  ownership: 'Transfer or delete all owned cookbooks before deleting this account.',
  proof: 'Send confirmation link',
  recovery: 'Recover account email',
  email: 'New email address',
  recoveryPending:
    'Confirmation link sent. The user has one hour to confirm the new address. You can close this dialog.',
  recoveryConfirmed: 'Your new email address is confirmed. You can now sign in with it.',
  recoveryConfirm: 'Confirm new email address',
  verified:
    'Verify the recovery claim independently and document your checks without storing identity documents. Enter the new address carefully. The user confirms it by link within one hour; the current address remains unchanged until then. You do not need to monitor the process.',
  sent: 'Notification sent.',
  failedMail:
    'Delivery failed. Check the outcome before retrying; an already completed account correction remains effective.',
  complete: 'Action completed.',
  accountScope:
    'Account status changes preserve cookbook ownership and content. Deactivation revokes account credentials; independent cookbook service accounts and public access remain.',
  accountDelete: 'Delete account',
  accountDisable: 'Deactivate account',
  accountEnable: 'Activate account',
  invalid: 'Enter a reason of 1–2,000 characters and complete the required confirmation.',
  counts: {
    recipeCount: 'Recipes',
    revisionCount: 'Revisions',
    shareCount: 'Shares',
    mediaCount: 'Media assets',
    memberCount: 'Cookbook members',
  },
};
export const safetyGerman: SafetyTranslation = {
  invalidProof:
    'Dieser Wiederherstellungslink ist ungültig, abgelaufen oder bereits verwendet. Bitte einen Administrator um einen neuen Link.',
  cooldown: 'Warte eine Minute, bevor du eine weitere Verifikationsnachricht anforderst.',
  emailUnavailable: 'Diese E-Mail-Adresse ist bereits zugewiesen oder kann nicht verwendet werden.',
  recoveryDisabled:
    'Vor der E-Mail-Wiederherstellung muss das Konto über den geprüften Verwaltungsablauf aktiviert werden.',
  mediaScope:
    'Medien werden aus einem anderen Kochbuch referenziert. Prüfe diese Verweise vor der Löschung.',

  deletion: 'Dauerhaft löschen',
  invalidUserReason: 'Die Begründung für den Benutzer darf höchstens 2.000 Zeichen enthalten.',
  invalidAdministrativeReason: 'Gib eine administrative Begründung mit 1–2.000 Zeichen an.',
  preservationRequired:
    'Bestätige über die Checkbox, dass du Aufbewahrungspflichten und Untersuchungsbedarf vor der Löschung geprüft hast.',
  invalidConfirmation: 'Gib zur Bestätigung der dauerhaften Löschung die genaue Ziel-UUID ein.',
  deletionNotification:
    'Nach der dauerhaften Löschung wird der Kochbuchbesitzer per E-Mail informiert. Die administrative Begründung bleibt vertraulich.',
  review: 'Löschumfang prüfen',
  reason: 'Administrative Begründung und durchgeführte Prüfung',
  confirmation: 'Zur Bestätigung die Ziel-UUID eingeben',
  preservation:
    'Ich habe Aufbewahrungspflichten und Untersuchungsbedarf geprüft; die Löschung darf erfolgen.',
  irreversible:
    'Die dauerhafte Löschung entfernt Live-Inhalte, Historie, Freigaben und ungenutzte Medien. Eine Rezeptlöschung erhält Kochbuchmitgliedschaften; eine Kochbuchlöschung entfernt Mitgliedschaften, keine Konten. Backups und Downloads bleiben bestehen. Sperre den Zugriff, wenn Untersuchung oder Aufbewahrung noch nötig sind.',
  stale: 'Der Löschumfang hat sich geändert. Prüfe ihn vor der Löschung erneut.',
  failure: 'Die Aktion ist fehlgeschlagen. Lade die Ansicht vor einem neuen Versuch neu.',
  lastAdmin: 'Diese Aktion würde den letzten nutzbaren Administrator entfernen.',
  ownership: 'Übertrage oder lösche alle eigenen Kochbücher, bevor dieses Konto gelöscht wird.',
  proof: 'Bestätigungslink senden',
  recovery: 'Konto-E-Mail wiederherstellen',
  email: 'Neue E-Mail-Adresse',
  recoveryPending:
    'Bestätigungslink versendet. Der Nutzer hat eine Stunde Zeit, die neue Adresse zu bestätigen. Du kannst diesen Dialog schließen.',
  recoveryConfirmed:
    'Deine neue E-Mail-Adresse ist bestätigt. Du kannst dich jetzt damit anmelden.',
  recoveryConfirm: 'Neue E-Mail-Adresse bestätigen',
  verified:
    'Prüfe die Berechtigung der Wiederherstellungsanfrage unabhängig und dokumentiere die Prüfung ohne Identitätsdokumente. Gib die neue Adresse sorgfältig ein. Der Nutzer bestätigt sie innerhalb einer Stunde per Link; bis dahin bleibt die bisherige Adresse gültig. Du musst den Vorgang nicht überwachen.',
  sent: 'Benachrichtigung versendet.',
  failedMail:
    'Zustellung fehlgeschlagen. Prüfe vor einem erneuten Versuch das Ergebnis; eine bereits abgeschlossene Kontokorrektur bleibt wirksam.',
  complete: 'Aktion abgeschlossen.',
  accountScope:
    'Statusänderungen erhalten Kochbucheigentum und Inhalte. Eine Deaktivierung widerruft Kontozugänge; unabhängige Kochbuch-Dienstkonten und öffentliche Zugriffe bleiben bestehen.',
  accountDelete: 'Konto löschen',
  accountDisable: 'Konto deaktivieren',
  accountEnable: 'Konto aktivieren',
  invalid:
    'Gib eine Begründung mit 1–2.000 Zeichen an und vervollständige die erforderliche Bestätigung.',
  counts: {
    recipeCount: 'Rezepte',
    revisionCount: 'Rezeptstände',
    shareCount: 'Freigaben',
    mediaCount: 'Medien',
    memberCount: 'Kochbuchmitglieder',
  },
};
