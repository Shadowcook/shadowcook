import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, ReactNode } from 'react';
import type { Translation } from '../../../i18n';
import { request, jsonRequest } from '../../../lib/api/client';
import type { InspectionPage } from './types';

export default function InspectionCollection<T>({
  endpoint,
  purpose,
  text,
  title,
  empty,
  children,
}: {
  endpoint: string;
  purpose: object;
  text: Translation;
  title: string;
  empty: string;
  children: (items: T[]) => ReactNode;
}): JSX.Element {
  const [query, setQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<InspectionPage<T> | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [retry, setRetry] = useState<number>(0);
  const labels: Translation['inspection'] = text.inspection;
  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    setBusy(true);
    setError(false);
    setData(null);
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => {
        void request<InspectionPage<T>>(endpoint, {
          ...jsonRequest({ ...purpose, query: query.trim(), page, pageSize: 25 }),
          signal: controller.signal,
        })
          .then((result: InspectionPage<T>): void => {
            if (!controller.signal.aborted) setData(result);
          })
          .catch((): void => {
            if (!controller.signal.aborted) setError(true);
          })
          .finally((): void => {
            if (!controller.signal.aborted) setBusy(false);
          });
      },
      query ? 300 : 0,
    );
    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, purpose, query, page, retry]);
  return (
    <section className="inspection__panel inspection__collection" aria-busy={busy}>
      <h2>{title}</h2>
      <label className="inspection__search">
        {labels.search}
        <input
          type="search"
          maxLength={254}
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => {
            setQuery(event.currentTarget.value);
            setPage(1);
          }}
        />
      </label>
      {busy ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <div role="alert">
          <p>{labels.error}</p>
          <button type="button" onClick={(): void => setRetry(retry + 1)}>
            {labels.retry}
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <p className="inspection__muted" role="status">
            {labels.results}: {data.total}
          </p>
          {data.items.length ? children(data.items) : <p>{query ? labels.noResults : empty}</p>}
          <nav className="inspection__pagination" aria-label={labels.pagination}>
            <button
              className="button--secondary"
              type="button"
              disabled={page <= 1}
              onClick={(): void => setPage(page - 1)}
            >
              {labels.previous}
            </button>
            <span>
              {labels.page} {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              className="button--secondary"
              type="button"
              disabled={page * data.pageSize >= data.total}
              onClick={(): void => setPage(page + 1)}
            >
              {labels.next}
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
