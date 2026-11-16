import { useEffect, useState, type JSX } from 'react';
import type { ErrorTranslation } from '../../i18n/errors';

export default function OfflineNotice({ text }: { text: ErrorTranslation }): JSX.Element | null {
  const [offline, setOffline] = useState<boolean>(false);
  useEffect((): (() => void) => {
    const update = (): void => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return (): void => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return offline ? (
    <p className="message error-state__offline" role="status">
      {text.network.description}
    </p>
  ) : null;
}
