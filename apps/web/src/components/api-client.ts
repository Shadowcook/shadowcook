export async function request<ResponseBody>(
  path: string,
  options?: RequestInit,
): Promise<ResponseBody> {
  const response: Response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  if (response.status === 204) return undefined as ResponseBody;
  const body: unknown = await response.json().catch((): null => null);
  if (!response.ok) throw new ApiRequestError(errorCodeFromBody(body));
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

  public constructor(code: string) {
    super(code);
    this.code = code;
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
