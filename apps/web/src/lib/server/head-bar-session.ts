const defaultApiOrigin: string = 'http://localhost:3000';

export interface HeadBarSession {
  authenticated: boolean;
  email: string;
  canAccessAdministration: boolean;
}

export interface AdminAreaState {
  access: 'granted' | 'unauthenticated' | 'denied';
  isAdministrator: boolean;
}

interface SessionResponse {
  email: string;
}

const signedOutSession: HeadBarSession = {
  authenticated: false,
  email: '',
  canAccessAdministration: false,
};

export async function loadHeadBarSession(cookie: string | null): Promise<HeadBarSession> {
  const session: SessionResponse | null = await getJson<SessionResponse>('/auth/session', cookie);
  if (session === null) return signedOutSession;

  const administrationResponse: Response | null = await getResponse('/admin/tenants', cookie);
  return {
    authenticated: true,
    email: session.email,
    canAccessAdministration: administrationResponse?.ok === true,
  };
}

export async function loadAdminAreaState(cookie: string | null): Promise<AdminAreaState> {
  const accessResponse: Response | null = await getResponse('/admin/tenants', cookie);
  if (accessResponse?.ok !== true) {
    return {
      access: accessResponse?.status === 401 ? 'unauthenticated' : 'denied',
      isAdministrator: false,
    };
  }
  const administratorResponse: Response | null = await getResponse('/admin/instance-roles', cookie);
  return { access: 'granted', isAdministrator: administratorResponse?.ok === true };
}

async function getJson<ResponseBody>(
  path: string,
  cookie: string | null,
): Promise<ResponseBody | null> {
  const response: Response | null = await getResponse(path, cookie);
  if (response === null || !response.ok) return null;
  return (await response.json()) as ResponseBody;
}

async function getResponse(path: string, cookie: string | null): Promise<Response | null> {
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  try {
    return await fetch(new URL(path, apiOrigin), {
      headers: cookie === null || cookie.length === 0 ? {} : { cookie },
    });
  } catch (_error: unknown) {
    return null;
  }
}
