import {
  cleanupFilePath,
  readCleanupSeed,
  seedFilePath,
  writeCleanupCsv,
} from './ingredient-cleanup.js';

function parseExecuteArgument(arguments_: string[]): boolean {
  const unsupported: string[] = arguments_.filter(
    (argument: string): boolean => argument !== '--execute',
  );
  if (unsupported.length > 0)
    throw new Error(`Unsupported export argument '${unsupported[0]}'. Only --execute is accepted.`);
  return arguments_.includes('--execute');
}

function main(): void {
  const execute: boolean = parseExecuteArgument(process.argv.slice(2));
  const inputPath: string = seedFilePath();
  const outputPath: string = cleanupFilePath();
  const count: number = writeCleanupCsv(readCleanupSeed(inputPath), outputPath, execute);
  if (!execute) {
    process.stdout.write(
      `Validated ${count} ingredients. Run the same command with --execute to write '${outputPath}'.\n`,
    );
    return;
  }
  process.stdout.write(`Wrote ${count} ingredients to '${outputPath}'.\n`);
}

main();
