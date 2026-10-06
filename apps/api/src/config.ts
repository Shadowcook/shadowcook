export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string | null;
  bootstrapPasswordChangeRequired: boolean;
  secureCookies: boolean;
  instanceSecretKey: Buffer | null;
  publicWebOrigin: string;
  publicApiOrigin: string;
  registration: RegistrationConfig;
}

export interface RegistrationConfig {
  turnstileSiteKey: string;
  pendingLifetimeMilliseconds: number;
  shortWindowMilliseconds: number;
  shortWindowRequests: number;
  dailyWindowMilliseconds: number;
  dailyWindowRequests: number;
  resendWindowMilliseconds: number;
  resendRequests: number;
  turnstileSecret: string;
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl: string | undefined = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL must be configured.');
  }

  const portValue: string = environment.PORT ?? '3000';
  const port: number = Number.parseInt(portValue, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const isDevelopment: boolean = environment.NODE_ENV === 'development';
  const bootstrapAdminEmail: string =
    environment.BOOTSTRAP_ADMIN_EMAIL ?? (isDevelopment ? 'admin@local' : 'admin@localhost');

  const instanceSecretKey: Buffer | null = parseInstanceSecretKey(
    readSecretEnvironmentValue(environment, 'INSTANCE_SECRET_KEY'),
  );
  const publicWebOrigin: string = (
    environment.PUBLIC_WEB_ORIGIN ?? 'http://localhost:4321'
  ).replace(/\/$/, '');
  return {
    databaseUrl,
    host: environment.HOST ?? '0.0.0.0',
    port,
    bootstrapAdminEmail,
    bootstrapAdminPassword: isDevelopment ? 'admin' : null,
    bootstrapPasswordChangeRequired: !isDevelopment,
    secureCookies: !isDevelopment,
    instanceSecretKey,
    publicWebOrigin,
    publicApiOrigin: (environment.PUBLIC_API_ORIGIN ?? `${publicWebOrigin}/api`).replace(/\/$/, ''),
    registration: {
      turnstileSiteKey: environment.TURNSTILE_SITE_KEY ?? '',
      pendingLifetimeMilliseconds: parseDuration(
        environment.SHADOWCOOK_REGISTRATION_PENDING_LIFETIME,
        24 * 60 * 60 * 1000,
      ),
      shortWindowMilliseconds: parseDuration(
        environment.SHADOWCOOK_REGISTRATION_RATE_SHORT_DURATION,
        15 * 60 * 1000,
      ),
      shortWindowRequests: parsePositiveInteger(
        environment.SHADOWCOOK_REGISTRATION_RATE_SHORT_REQUESTS,
        5,
      ),
      dailyWindowMilliseconds: parseDuration(
        environment.SHADOWCOOK_REGISTRATION_RATE_DAILY_DURATION,
        24 * 60 * 60 * 1000,
      ),
      dailyWindowRequests: parsePositiveInteger(
        environment.SHADOWCOOK_REGISTRATION_RATE_DAILY_REQUESTS,
        20,
      ),
      resendWindowMilliseconds: parseDuration(
        environment.SHADOWCOOK_REGISTRATION_RESEND_DURATION,
        60 * 60 * 1000,
      ),
      resendRequests: parsePositiveInteger(environment.SHADOWCOOK_REGISTRATION_RESEND_REQUESTS, 3),
      turnstileSecret: readSecretEnvironmentValue(environment, 'TURNSTILE_SECRET') ?? '',
    },
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed: number = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error('Registration request limits must be positive integers.');
  return parsed;
}
function parseDuration(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const match: RegExpMatchArray | null = value.match(/^(\d+)(ms|s|m|h|d)$/);
  if (match === null) throw new Error('Registration durations must use ms, s, m, h, or d units.');
  const factors: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const milliseconds: number = Number.parseInt(match[1]!, 10) * factors[match[2]!]!;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1)
    throw new Error('Registration durations must be positive.');
  return milliseconds;
}

function readSecretEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const directValue: string | undefined = environment[name];
  const fileName: string = `${name}_FILE`;
  const secretFilePath: string | undefined = environment[fileName];
  if (
    directValue !== undefined &&
    directValue.trim().length > 0 &&
    secretFilePath !== undefined &&
    secretFilePath.trim().length > 0
  ) {
    throw new Error(`${name} and ${fileName} cannot both be configured.`);
  }
  if (secretFilePath === undefined || secretFilePath.trim().length === 0) return directValue;
  return readFileSync(secretFilePath.trim(), 'utf8').trim();
}

function parseInstanceSecretKey(value: string | undefined): Buffer | null {
  if (value === undefined || value.trim().length === 0) return null;
  const key: Buffer = Buffer.from(value, 'base64');
  if (key.length !== 32)
    throw new Error('INSTANCE_SECRET_KEY must be a base64-encoded 32-byte key.');
  return key;
}
import { readFileSync } from 'node:fs';
