import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadLocalEnvironment(): void {
  const environmentFilePath: string = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(environmentFilePath)) {
    process.loadEnvFile(environmentFilePath);
  }
}
