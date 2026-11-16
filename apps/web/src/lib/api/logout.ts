import { ApiRequestError, jsonRequest, request } from './client.ts';

export async function logout(): Promise<void> {
  for (let attempt: number = 0; attempt < 2; attempt += 1) {
    try {
      await request<void>('/auth/logout', {
        ...jsonRequest({}),
        signal: AbortSignal.timeout(10000),
      });
      return;
    } catch (error: unknown) {
      // Logout is idempotent, including when the first response was lost after revocation.
      const retryable: boolean =
        error instanceof ApiRequestError
          ? error.code === 'NETWORK_ERROR' || (error.status !== undefined && error.status >= 500)
          : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
      if (attempt === 1 || !retryable) throw error;
    }
  }
}
