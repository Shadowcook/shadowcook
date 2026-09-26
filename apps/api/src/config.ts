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
  return {
    databaseUrl,
    host: environment.HOST ?? '0.0.0.0',
    port,
    bootstrapAdminEmail,
    bootstrapAdminPassword: isDevelopment ? 'admin' : null,
    bootstrapPasswordChangeRequired: !isDevelopment,
    secureCookies: !isDevelopment,
    instanceSecretKey,
    publicWebOrigin: (environment.PUBLIC_WEB_ORIGIN ?? 'http://localhost:4321').replace(/\/$/, ''),
  };
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
