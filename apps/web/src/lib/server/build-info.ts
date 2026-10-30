import packageManifest from '../../../../../package.json';

export const applicationVersion: string = packageManifest.version;

export function buildCommit(): string | undefined {
  return process.env.SHADOWCOOK_BUILD_COMMIT;
}
