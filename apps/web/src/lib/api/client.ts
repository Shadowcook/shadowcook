export async function request<ResponseBody>(
  path: string,
  options?: RequestInit,
): Promise<ResponseBody> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiRequestError('NETWORK_ERROR');
  }
  if (response.status === 204) return undefined as ResponseBody;
  const body: unknown = await response.json().catch((): null => null);
  if (!response.ok) throw await responseError(response, body);
  return body as ResponseBody;
}

export function jsonRequest(body: object): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly status: number | undefined;

  public readonly requestId: string | undefined;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    code: string,
    status?: number,
    requestId?: string,
    retryAfterSeconds?: number,
  ) {
    super(code);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function errorCodeFromBody(body: unknown): string {
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : 'REQUEST_FAILED';
}

export async function responseError(
  response: Response,
  parsedBody?: unknown,
): Promise<ApiRequestError> {
  const body: unknown =
    parsedBody === undefined ? await response.json().catch((): null => null) : parsedBody;
  const retryAfter: string | null = response.headers.get('retry-after');
  const seconds: number =
    retryAfter === null
      ? NaN
      : /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
  return new ApiRequestError(
    errorCodeFromBody(body),
    response.status,
    response.headers.get('x-request-id') ?? undefined,
    Number.isFinite(seconds) ? Math.max(0, seconds) : undefined,
  );
}
