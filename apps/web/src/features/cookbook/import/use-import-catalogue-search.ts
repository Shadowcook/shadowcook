import { useEffect, useState } from 'react';
import { request } from '../../../lib/api/client';
import { equivalentImportUnit } from './model';
import type { ImportCandidate, ImportConversion } from './types';

interface SearchResult {
  query: string;
  candidates: ImportCandidate[];
  status: 'loading' | 'ready' | 'error';
}

export function useImportCatalogueSearch(
  open: boolean,
  query: string,
  tenantSlug: string,
  isUnit: boolean,
  conversion: ImportConversion | undefined,
  onError: (error: unknown) => void,
): SearchResult {
  const [result, setResult] = useState<SearchResult>({
    query: '',
    candidates: [],
    status: 'loading',
  });
  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const controller: AbortController = new AbortController();
    const timeout: number = window.setTimeout((): void => {
      const parameters: URLSearchParams = new URLSearchParams({
        kind: isUnit ? 'UNIT' : 'INGREDIENT',
        search: query,
      });
      void request<{ candidates: ImportCandidate[] }>(
        `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipe-imports/catalogue?${parameters}`,
        { signal: controller.signal },
      )
        .then((response: { candidates: ImportCandidate[] }): void => {
          if (!controller.signal.aborted)
            setResult({
              query,
              status: 'ready',
              candidates: response.candidates.filter(
                (candidate: ImportCandidate): boolean =>
                  !isUnit || equivalentImportUnit(conversion, candidate.conversion),
              ),
            });
        })
        .catch((error: unknown): void => {
          if (!controller.signal.aborted) {
            setResult({ query, candidates: [], status: 'error' });
            onError(error);
          }
        });
    }, 200);
    return (): void => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // The caller's error callback does not affect search identity.
  }, [open, query, tenantSlug, isUnit, conversion]);
  return result.query === query ? result : { query, candidates: [], status: 'loading' };
}
