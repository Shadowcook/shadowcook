export interface ErrorTranslation {
  brand: string;
  conflict: string;
  home: string;
  retry: string;
  login: string;
  requestId: string;
  wait: string;
  notFound: { title: string; description: string };
  denied: { title: string; description: string };
  authentication: { title: string; description: string };
  service: { title: string; description: string };
  network: { title: string; description: string };
  unexpected: { title: string; description: string };
  limited: { title: string; description: string };
}
export const errorEnglish: ErrorTranslation = {
  brand: 'Shadowcook',
  conflict: 'This change conflicts with the current data. Review your input and try again.',
  home: 'Go to homepage',
  retry: 'Try again',
  login: 'Log in',
  requestId: 'Request ID',
  wait: 'Please wait {seconds} seconds before trying again.',
  notFound: {
    title: 'Not on the menu.',
    description: 'The page, cookbook or recipe could not be found.',
  },
  denied: {
    title: 'Access denied.',
    description: 'You do not have permission to view this content.',
  },
  authentication: {
    title: 'Please log in.',
    description: 'Your session may have expired. Log in to continue.',
  },
  service: {
    title: 'Something burned in the kitchen.',
    description: 'Something went wrong on our side. Please try again later.',
  },
  network: {
    title: 'The connection was lost.',
    description: 'Check your internet connection and try again.',
  },
  unexpected: {
    title: 'Something went wrong.',
    description: 'This view could not be displayed. Reload the page to try again.',
  },
  limited: {
    title: 'Please take a short break.',
    description: 'Too many requests. Please wait before trying again.',
  },
};
export const errorGerman: ErrorTranslation = {
  brand: 'Shadowcook',
  conflict:
    'Diese Änderung steht im Konflikt mit den aktuellen Daten. Prüfe deine Eingabe und versuche es erneut.',
  home: 'Zur Startseite',
  retry: 'Erneut versuchen',
  login: 'Anmelden',
  requestId: 'Anfrage-ID',
  wait: 'Bitte warte {seconds} Sekunden vor dem nächsten Versuch.',
  notFound: {
    title: 'Nicht auf der Speisekarte.',
    description: 'Die gesuchte Seite, das Kochbuch oder das Rezept wurde nicht gefunden.',
  },
  denied: {
    title: 'Zugriff verweigert.',
    description: 'Du hast keinen Zugriff auf diesen Inhalt.',
  },
  authentication: {
    title: 'Bitte melde dich an.',
    description: 'Deine Sitzung ist möglicherweise abgelaufen. Melde dich an, um fortzufahren.',
  },
  service: {
    title: 'Hier ist etwas angebrannt.',
    description: 'Bei uns ist gerade etwas schiefgelaufen. Bitte versuche es später erneut.',
  },
  network: {
    title: 'Die Verbindung ist abgerissen.',
    description: 'Prüfe deine Internetverbindung und versuche es erneut.',
  },
  unexpected: {
    title: 'Etwas ist schiefgelaufen.',
    description: 'Diese Ansicht konnte nicht angezeigt werden. Lade die Seite erneut.',
  },
  limited: {
    title: 'Bitte mach eine kurze Pause.',
    description: 'Zu viele Anfragen. Bitte warte vor dem nächsten Versuch.',
  },
};
