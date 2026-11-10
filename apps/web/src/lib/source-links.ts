export const githubRepositoryUrl: string = 'https://github.com/Shadowcook/shadowcook';

export function licenseUrl(buildCommit: string | undefined): string | undefined {
  return buildCommit === undefined || buildCommit.length === 0
    ? undefined
    : `${githubRepositoryUrl}/blob/${buildCommit}/LICENSE`;
}
