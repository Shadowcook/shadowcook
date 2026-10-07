import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { migrateDatabase } from '@shadowcook/db';
import { Pool } from 'pg';

const executeFile: (
  file: string,
  arguments_: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);
const databaseName: string = 'shadowcook_test';
const databaseUser: string = 'shadowcook_test';
const postgresImage: string = 'postgres:17.6-alpine';
const startupTimeoutMilliseconds: number = 60_000;
const startupRetryMilliseconds: number = 500;

export interface DisposablePostgresDatabase {
  databaseUrl: string;
  pool: Pool;
  close(): Promise<void>;
}

export async function createDisposablePostgresDatabase(): Promise<DisposablePostgresDatabase> {
  const containerName: string = `shadowcook-test-${randomUUID()}`;
  const databasePassword: string = randomBytes(24).toString('base64url');
  let started: boolean = false;

  try {
    await executeFile('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--label',
      'com.shadowcook.test=true',
      '--env',
      `POSTGRES_DB=${databaseName}`,
      '--env',
      `POSTGRES_USER=${databaseUser}`,
      '--env',
      `POSTGRES_PASSWORD=${databasePassword}`,
      '--publish',
      '127.0.0.1::5432',
      postgresImage,
    ]);
    started = true;

    const portResult: { stdout: string; stderr: string } = await executeFile('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      containerName,
    ]);
    const port: string = portResult.stdout.trim();
    if (!/^\d+$/.test(port)) {
      throw new Error('Docker did not assign a TCP port to the disposable PostgreSQL container.');
    }

    const databaseUrl: string = `postgresql://${databaseUser}:${encodeURIComponent(databasePassword)}@127.0.0.1:${port}/${databaseName}`;
    const pool: Pool = new Pool({ connectionString: databaseUrl });
    await waitForPostgres(pool);
    await migrateDatabase(pool);

    return {
      databaseUrl,
      pool,
      close: async (): Promise<void> => {
        await pool.end();
        await stopContainer(containerName);
      },
    };
  } catch (error: unknown) {
    if (started) await stopContainer(containerName);
    throw error;
  }
}

async function waitForPostgres(pool: Pool): Promise<void> {
  const deadline: number = Date.now() + startupTimeoutMilliseconds;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error: unknown) {
      lastError = error;
      await delay(startupRetryMilliseconds);
    }
  }

  await pool.end();
  throw new Error('Disposable PostgreSQL container did not become ready in time.', {
    cause: lastError,
  });
}

async function stopContainer(containerName: string): Promise<void> {
  try {
    await executeFile('docker', ['rm', '--force', containerName]);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    if (!message.includes('No such container')) throw error;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, milliseconds);
  });
}
