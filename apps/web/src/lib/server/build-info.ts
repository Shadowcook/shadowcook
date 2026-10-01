export function buildCommit(): string | undefined {
  return process.env.SHADOWCOOK_BUILD_COMMIT;
}
