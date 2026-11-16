import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Locale, Translation } from '../../../i18n';
import { request, jsonRequest, responseError } from '../../../lib/api/client';
import type { InspectionRevision } from './types';
import InspectedRevision from './InspectedRevision';

export default function InspectionRevisionContent({
  path,
  purpose,
  text,
  locale,
}: {
  path: string;
  purpose: object;
  text: Translation;
  locale: Locale;
}): JSX.Element {
  const [data, setData] = useState<InspectionRevision | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<boolean>(false);
  const [retry, setRetry] = useState<number>(0);
  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    const urls: string[] = [];
    setData(null);
    setImages([]);
    setError(false);
    async function load(): Promise<void> {
      try {
        const result: InspectionRevision = await request<InspectionRevision>(`${path}/inspection`, {
          ...jsonRequest(purpose),
          signal: controller.signal,
        });
        for (const media of result.media) {
          const response: Response = await fetch(
            `/api${path}/media/${media.public_id}/inspection`,
            {
              ...jsonRequest(purpose),
              credentials: 'same-origin',
              signal: controller.signal,
            },
          );
          if (!response.ok) throw await responseError(response);
          const blob: Blob = await response.blob();
          if (controller.signal.aborted) return;
          urls.push(URL.createObjectURL(blob));
        }
        if (!controller.signal.aborted) {
          setData(result);
          setImages([...urls]);
        }
      } catch {
        urls.forEach((url: string): void => URL.revokeObjectURL(url));
        urls.length = 0;
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return (): void => {
      controller.abort();
      urls.forEach((url: string): void => URL.revokeObjectURL(url));
    };
  }, [path, purpose, retry]);
  useEffect((): void => {
    if (data) document.getElementById('inspection-revision-content')?.focus();
  }, [data]);
  if (error)
    return (
      <div className="inspection__panel" role="alert">
        <p>{text.inspection.error}</p>
        <button type="button" onClick={(): void => setRetry(retry + 1)}>
          {text.inspection.retry}
        </button>
      </div>
    );
  return data ? (
    <InspectedRevision data={data} images={images} text={text} locale={locale} />
  ) : (
    <p className="inspection__panel" role="status">
      {text.loading}
    </p>
  );
}
