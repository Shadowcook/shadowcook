import { errorEnglish, errorGerman } from './errors.ts';
import type { Locale } from './types';

export type ProxyErrorStatus = 500 | 502 | 503 | 504;

interface ProxyErrorCopy {
  title: string;
  description: string;
}

export interface ProxyErrorTranslation {
  brand: string;
  home: string;
  statusLabel: string;
  errors: Record<ProxyErrorStatus, ProxyErrorCopy>;
}

export const proxyErrorTranslations: Record<Locale, ProxyErrorTranslation> = {
  en: {
    brand: errorEnglish.brand,
    home: errorEnglish.home,
    statusLabel: 'Error {status}',
    errors: {
      500: {
        title: 'Oh dear! That wasn’t in the recipe.',
        description:
          'Something went wrong on our side. We’re checking the recipe and getting the kitchen back in order. Please try again in a moment.',
      },
      502: {
        title: 'Hello, kitchen? Anyone there?',
        description:
          'The kitchen isn’t sending back a proper answer right now. We’re checking the connection. Please try again in a moment.',
      },
      503: {
        title: 'Oops! Someone made a mess in the kitchen.',
        description:
          'We’re already cleaning up! Shadowcook is briefly unavailable while we get the kitchen ready again. Please try again in a moment.',
      },
      504: {
        title: 'Ding! The timer beat us to it.',
        description:
          'The kitchen took too long to answer. We’re checking what’s holding things up. Please try again in a moment.',
      },
    },
  },
  de: {
    brand: errorGerman.brand,
    home: errorGerman.home,
    statusLabel: 'Fehler {status}',
    errors: {
      500: {
        title: 'Oh je! Das stand nicht im Rezept.',
        description:
          'Bei uns ist etwas schiefgelaufen. Wir prüfen das Rezept und bringen die Küche wieder in Ordnung. Bitte versuche es gleich noch einmal.',
      },
      502: {
        title: 'Hallo, Küche? Ist da jemand?',
        description:
          'Aus der Küche kommt gerade keine brauchbare Antwort. Wir prüfen die Verbindung. Bitte versuche es gleich noch einmal.',
      },
      503: {
        title: 'Huch! Hier herrscht Küchenchaos.',
        description:
          'Wir schwingen schon den Putzlappen! Shadowcook ist kurz nicht erreichbar, während wir die Küche wieder in Schuss bringen. Bitte versuche es gleich noch einmal.',
      },
      504: {
        title: 'Bing! Die Küchenuhr war schneller.',
        description:
          'Die Antwort aus der Küche hat zu lange auf sich warten lassen. Wir schauen nach, wo es gerade hakt. Bitte versuche es gleich noch einmal.',
      },
    },
  },
};
