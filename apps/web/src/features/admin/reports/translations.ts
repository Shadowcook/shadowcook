export interface WorkflowTranslation {
  title: string;
  separation: string;
  inspect: string;
  account: string;
  unavailable: string;
  refresh: string;
  current: string;
  active: string;
  restricted: string;
  states: Record<string, string>;
  history: string;
  historyHint: string;
  historyPurpose: string;
  loadHistory: string;
  empty: string;
  eventId: string;
  actor: string;
  before: string;
  after: string;
  requestId: string;
  linkEvent: string;
  linkHint: string;
  linked: string;
  invalid: string;
  failed: string;
  notice: string;
  noticeHint: string;
  recipient: string;
  roles: Record<'REPORTER' | 'TARGET', string>;
  publicMessage: string;
  reviewInstructions: string;
  noticeConfirmation: string;
  noticeSent: string;
  noticeFailed: string;
  delivery: Record<'PENDING' | 'SENT' | 'FAILED', string>;
  notices: string;
  returnReport: string;
  workflowUpdate: string;
  action: string;
  actions: Record<string, string>;
}
export const workflowEnglish: WorkflowTranslation = {
  title: 'Investigation and actions',
  separation:
    'Ticket outcomes record a decision. Restriction, ownership transfer, deletion and notices are separate confirmed actions. Internal investigation notes are never included automatically in user notices.',
  inspect: 'Inspect content and review actions',
  account: 'Review account and recovery actions',
  unavailable:
    'The target is unavailable or deleted. The ticket and retained history remain accessible.',
  refresh: 'Recheck current state',
  current: 'Current target state',
  active: 'Clear',
  restricted: 'Set',
  states: {
    cookbookDisabled: 'Cookbook deactivated',
    identityResetRequired: 'Cookbook identity reset required',
    recipeBlocked: 'Recipe blocked',
    trashed: 'Recipe in trash',
    accountDisabled: 'Account deactivated',
  },
  history: 'Administrative history',
  historyHint:
    'Only recorded, retained actions appear here. Ticket decisions do not prove that enforcement occurred. Historical states may differ from the current target state.',
  historyPurpose: 'Purpose for accessing history or linking an event',
  loadHistory: 'Load history',
  empty: 'No retained entries on this page.',
  eventId: 'Audit event UUID',
  actor: 'Acting principal UUID',
  before: 'Recorded previous state',
  after: 'Recorded resulting state',
  requestId: 'Request ID',
  linkEvent: 'Associate existing audit event',
  linkHint:
    'Associate a known event for this target or its applicable cookbook scope. This adds a reference and does not repeat the action or edit the original event.',
  linked: 'Event associated.',
  invalid: 'Enter a purpose of 1–2,000 characters and complete all required fields.',
  failed:
    'The request failed or the event is unavailable for this target. Recheck the current state before retrying.',
  notice: 'Send a public decision or review notice',
  noticeHint:
    'Choose whether and when notice is appropriate. Write a separate public explanation and actionable contact instructions for review. Send target-owner notices before deleting content. Delivery has no automatic retry; review history before sending another notice.',
  recipient: 'Notice recipient',
  roles: { REPORTER: 'Reporter', TARGET: 'Reported account or current cookbook owner' },
  publicMessage: 'Public explanation sent to the recipient',
  reviewInstructions: 'How to request review, including an operator contact address or URL',
  noticeConfirmation:
    'Send only the public explanation and review instructions shown below to this account. Internal report notes and investigation reasons are excluded.',
  noticeSent: 'Notice committed and sent.',
  noticeFailed: 'Notice committed, but delivery failed. Recheck history before sending again.',
  delivery: {
    PENDING: 'Delivery pending or outcome unknown',
    SENT: 'Sent',
    FAILED: 'Delivery failed',
  },
  notices: 'Public notices and delivery outcomes',
  returnReport: 'Return to report',
  workflowUpdate: 'Report decision or assignment updated',
  action: 'Administrative action',
  actions: {
    ADMIN_REPORT_UPDATED: 'Report updated',
    ADMIN_REPORT_EVENT_LINKED: 'Audit event associated',
    ADMIN_REPORT_NOTICE_CREATED: 'Public notice created',
    ADMIN_COOKBOOK_INSPECTED: 'Cookbook inspected',
    ADMIN_RECIPES_INSPECTED: 'Recipe list inspected',
    ADMIN_MEMBERS_INSPECTED: 'Member list inspected',
    ADMIN_REPORTS_INSPECTED: 'Report list inspected',
    ADMIN_REVISIONS_INSPECTED: 'Revision list inspected',
    ADMIN_REVISION_INSPECTED: 'Revision inspected',
    ADMIN_MEDIA_INSPECTED: 'Media inspected',
    ADMIN_OWNERSHIP_CANDIDATES_READ: 'Ownership recipients reviewed',
    ADMIN_OWNERSHIP_TRANSFERRED: 'Ownership transferred',
    ADMIN_COOKBOOK_MODERATED: 'Cookbook restriction changed',
    ADMIN_RECIPE_MODERATED: 'Recipe restriction changed',
    ADMIN_COOKBOOK_DELETION_REVIEWED: 'Cookbook deletion reviewed',
    ADMIN_RECIPE_DELETION_REVIEWED: 'Recipe deletion reviewed',
    ADMIN_COOKBOOK_DELETED: 'Cookbook permanently deleted',
    ADMIN_RECIPE_DELETED: 'Recipe permanently deleted',
    ADMIN_USER_STATUS: 'Account status changed',
    ADMIN_USER_DELETE: 'Account deleted',
    ADMIN_USER_ROLES: 'Instance roles changed',
    ADMIN_USER_EMAIL_PROOF: 'Email recovery proof requested',
    ADMIN_USER_EMAIL_RECOVERY: 'Account email recovered',
    ADMIN_USER_EMAIL_CONFIRMATION_REQUESTED: 'Email recovery confirmation requested',
    ADMIN_USER_EMAIL_RECOVERED: 'Recovery email confirmed by recipient',
  },
};
export const workflowGerman: WorkflowTranslation = {
  title: 'Untersuchung und Aktionen',
  separation:
    'Ticketergebnisse halten eine Entscheidung fest. Sperrung, Eigentumsübertragung, Löschung und Benachrichtigung sind separate bestätigte Aktionen. Interne Untersuchungsnotizen werden niemals automatisch in Benachrichtigungen übernommen.',
  inspect: 'Inhalte untersuchen und Aktionen prüfen',
  account: 'Konto und Wiederherstellungsaktionen prüfen',
  unavailable:
    'Das Ziel ist nicht verfügbar oder gelöscht. Ticket und aufbewahrte Historie bleiben zugänglich.',
  refresh: 'Aktuellen Zustand erneut prüfen',
  current: 'Aktueller Zielzustand',
  active: 'Nicht gesetzt',
  restricted: 'Gesetzt',
  states: {
    cookbookDisabled: 'Kochbuch deaktiviert',
    identityResetRequired: 'Kochbuch-Identität muss geändert werden',
    recipeBlocked: 'Rezept gesperrt',
    trashed: 'Rezept im Papierkorb',
    accountDisabled: 'Konto deaktiviert',
  },
  history: 'Administrative Historie',
  historyHint:
    'Hier erscheinen nur erfasste, noch aufbewahrte Aktionen. Ticketergebnisse belegen keine Durchführung. Historische Zustände können vom aktuellen Zielzustand abweichen.',
  historyPurpose: 'Zweck des Historienzugriffs oder der Ereigniszuordnung',
  loadHistory: 'Historie laden',
  empty: 'Keine aufbewahrten Einträge auf dieser Seite.',
  eventId: 'UUID des Audit-Ereignisses',
  actor: 'UUID des handelnden Principals',
  before: 'Erfasster vorheriger Zustand',
  after: 'Erfasster resultierender Zustand',
  requestId: 'Anfrage-ID',
  linkEvent: 'Vorhandenes Audit-Ereignis zuordnen',
  linkHint:
    'Ordne ein bekanntes Ereignis für dieses Ziel oder den zugehörigen Kochbuchumfang zu. Dies ergänzt einen Verweis, wiederholt keine Aktion und verändert das Originalereignis nicht.',
  linked: 'Ereignis zugeordnet.',
  invalid: 'Gib einen Zweck mit 1–2.000 Zeichen an und vervollständige alle Pflichtfelder.',
  failed:
    'Die Anfrage ist fehlgeschlagen oder das Ereignis ist für dieses Ziel nicht verfügbar. Prüfe vor einem erneuten Versuch den aktuellen Zustand.',
  notice: 'Öffentliche Entscheidungs- oder Prüfmitteilung versenden',
  noticeHint:
    'Prüfe, ob und wann eine Mitteilung angemessen ist. Verfasse eine separate öffentliche Erklärung und konkrete Kontaktangaben zur erneuten Prüfung. Benachrichtige Eigentümer vor einer Inhaltslöschung. Es gibt keine automatische Wiederholung; prüfe vor erneutem Versand die Historie.',
  recipient: 'Empfänger der Mitteilung',
  roles: {
    REPORTER: 'Meldende Person',
    TARGET: 'Gemeldetes Konto oder aktueller Kochbucheigentümer',
  },
  publicMessage: 'Öffentliche Erklärung für den Empfänger',
  reviewInstructions: 'Weg zur erneuten Prüfung mit Kontaktadresse oder URL des Betreibers',
  noticeConfirmation:
    'Versende nur die unten angezeigte öffentliche Erklärung und Prüfanleitung an dieses Konto. Interne Ticketnotizen und Untersuchungsgründe bleiben ausgeschlossen.',
  noticeSent: 'Mitteilung gespeichert und versendet.',
  noticeFailed:
    'Mitteilung gespeichert, aber Zustellung fehlgeschlagen. Prüfe vor erneutem Versand die Historie.',
  delivery: {
    PENDING: 'Zustellung ausstehend oder Ergebnis unbekannt',
    SENT: 'Versendet',
    FAILED: 'Zustellung fehlgeschlagen',
  },
  notices: 'Öffentliche Mitteilungen und Zustellergebnisse',
  returnReport: 'Zurück zur Meldung',
  workflowUpdate: 'Ticketentscheidung oder Zuweisung geändert',
  action: 'Administrative Aktion',
  actions: {
    ADMIN_REPORT_UPDATED: 'Ticket geändert',
    ADMIN_REPORT_EVENT_LINKED: 'Audit-Ereignis zugeordnet',
    ADMIN_REPORT_NOTICE_CREATED: 'Öffentliche Mitteilung erstellt',
    ADMIN_COOKBOOK_INSPECTED: 'Kochbuch untersucht',
    ADMIN_RECIPES_INSPECTED: 'Rezeptliste eingesehen',
    ADMIN_MEMBERS_INSPECTED: 'Mitgliederliste eingesehen',
    ADMIN_REPORTS_INSPECTED: 'Meldungsliste eingesehen',
    ADMIN_REVISIONS_INSPECTED: 'Versionsliste eingesehen',
    ADMIN_REVISION_INSPECTED: 'Revision untersucht',
    ADMIN_MEDIA_INSPECTED: 'Medien untersucht',
    ADMIN_OWNERSHIP_CANDIDATES_READ: 'Eigentumsempfänger geprüft',
    ADMIN_OWNERSHIP_TRANSFERRED: 'Eigentum übertragen',
    ADMIN_COOKBOOK_MODERATED: 'Kochbuchsperre geändert',
    ADMIN_RECIPE_MODERATED: 'Rezeptsperre geändert',
    ADMIN_COOKBOOK_DELETION_REVIEWED: 'Kochbuchlöschung geprüft',
    ADMIN_RECIPE_DELETION_REVIEWED: 'Rezeptlöschung geprüft',
    ADMIN_COOKBOOK_DELETED: 'Kochbuch dauerhaft gelöscht',
    ADMIN_RECIPE_DELETED: 'Rezept dauerhaft gelöscht',
    ADMIN_USER_STATUS: 'Kontostatus geändert',
    ADMIN_USER_DELETE: 'Konto gelöscht',
    ADMIN_USER_ROLES: 'Instanzrollen geändert',
    ADMIN_USER_EMAIL_PROOF: 'E-Mail-Nachweis angefordert',
    ADMIN_USER_EMAIL_RECOVERY: 'Konto-E-Mail wiederhergestellt',
    ADMIN_USER_EMAIL_CONFIRMATION_REQUESTED: 'E-Mail-Bestätigung zur Wiederherstellung angefordert',
    ADMIN_USER_EMAIL_RECOVERED: 'Wiederherstellungsadresse vom Empfänger bestätigt',
  },
};
