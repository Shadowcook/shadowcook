export interface OwnershipTranslation {
  searchHelp: string;
  searching: string;
  searchFailed: string;
  refine: string;
  selected: string;
  title: string;
  search: string;
  select: string;
  recipient: string;
  previous: string;
  next: string;
  formerRole: string;
  remove: string;
  viewer: string;
  editor: string;
  reason: string;
  verification: string;
  review: string;
  confirm: string;
  success: string;
  failedMail: string;
  sentMail: string;
  oldOwner: string;
  newOwner: string;
  noOwner: string;
  failure: string;
  conflict: string;
  roleConflict: string;
  invalid: string;
  empty: string;
}
export const ownershipEnglish: OwnershipTranslation = {
  searchHelp: 'Enter at least two characters. Matching accounts appear automatically below.',
  searching: 'Searching accounts…',
  searchFailed: 'Account search failed. Change the search text to try again.',
  refine: 'Showing up to 50 accounts. Refine your search to find the intended account.',
  selected: 'Selected',
  title: 'Transfer cookbook ownership',
  search: 'Find an active account by email, name or account UUID',
  select: 'Search accounts',
  recipient: 'Recipient account',
  previous: 'Previous owner',
  next: 'New owner',
  formerRole: 'Former owner membership',
  remove: 'Remove membership',
  viewer: 'Retain as Viewer',
  editor: 'Retain as Editor',
  reason: 'Transfer reason and verification performed',
  verification:
    'Verify that the recovery request is legitimate before transferring ownership. Record the verification in the reason without storing identity documents. Cookbook restrictions remain in effect.',
  review: 'Review transfer',
  confirm: 'Confirm ownership transfer',
  success: 'Ownership transferred.',
  failedMail:
    'Notification failed. The transfer succeeded; contact the affected account through an appropriate channel.',
  sentMail: 'Notification sent.',
  oldOwner: 'Previous owner',
  newOwner: 'New owner',
  noOwner: 'No assigned owner (pending owner invitations will be cancelled)',
  failure: 'The transfer could not be completed. Reload the inspection before retrying.',
  conflict:
    'Ownership changed since this view was loaded. Reload the inspection before transferring.',
  roleConflict: 'Inconsistent ownership roles require review before transfer.',
  invalid: 'Select a different active account and enter a reason of 1–2,000 characters.',
  empty: 'No matching active accounts.',
};
export const ownershipGerman: OwnershipTranslation = {
  searchHelp: 'Gib mindestens zwei Zeichen ein. Passende Konten erscheinen automatisch darunter.',
  searching: 'Konten werden gesucht…',
  searchFailed:
    'Die Kontosuche ist fehlgeschlagen. Ändere den Suchtext, um es erneut zu versuchen.',
  refine:
    'Bis zu 50 Konten werden angezeigt. Grenze die Suche ein, um das gewünschte Konto zu finden.',
  selected: 'Ausgewählt',
  title: 'Kochbuch-Eigentum übertragen',
  search: 'Aktives Konto anhand E-Mail, Name oder Konto-UUID suchen',
  select: 'Konten suchen',
  recipient: 'Empfängerkonto',
  previous: 'Bisheriger Eigentümer',
  next: 'Neuer Eigentümer',
  formerRole: 'Mitgliedschaft des bisherigen Eigentümers',
  remove: 'Mitgliedschaft entfernen',
  viewer: 'Als Leser behalten',
  editor: 'Als Bearbeiter behalten',
  reason: 'Begründung der Übertragung und durchgeführte Verifikation',
  verification:
    'Prüfe vor der Übertragung, ob die Wiederherstellungsanfrage berechtigt ist. Dokumentiere die Prüfung in der Begründung, ohne Identitätsdokumente zu speichern. Kochbuchsperren bleiben bestehen.',
  review: 'Übertragung prüfen',
  confirm: 'Eigentumsübertragung bestätigen',
  success: 'Eigentum übertragen.',
  failedMail:
    'Benachrichtigung fehlgeschlagen. Die Übertragung war erfolgreich; kontaktiere das betroffene Konto auf geeignetem Weg.',
  sentMail: 'Benachrichtigung versendet.',
  oldOwner: 'Bisheriger Eigentümer',
  newOwner: 'Neuer Eigentümer',
  noOwner: 'Kein Eigentümer zugewiesen (offene Eigentümereinladungen werden aufgehoben)',
  failure:
    'Die Übertragung konnte nicht abgeschlossen werden. Lade die Einsicht vor einem erneuten Versuch neu.',
  conflict:
    'Der Eigentümer hat sich seit dem Laden geändert. Lade die Einsicht vor der Übertragung neu.',
  roleConflict: 'Widersprüchliche Eigentümerrollen müssen vor der Übertragung geprüft werden.',
  invalid: 'Wähle ein anderes aktives Konto und gib eine Begründung mit 1–2.000 Zeichen an.',
  empty: 'Keine passenden aktiven Konten.',
};
