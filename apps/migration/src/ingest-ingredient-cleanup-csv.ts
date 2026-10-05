import {
  applyIngredientCleanup,
  cleanupFilePath,
  readCleanupCsv,
  readCleanupSeed,
  seedFilePath,
  writeSeedAtomically,
} from './ingredient-cleanup.js';

function parseExecuteArgument(arguments_: string[]): boolean {
  const unsupported: string[] = arguments_.filter(
    (argument: string): boolean => argument !== '--execute',
  );
  if (unsupported.length > 0)
    throw new Error(`Unsupported import argument '${unsupported[0]}'. Only --execute is accepted.`);
  return arguments_.includes('--execute');
}

function main(): void {
  const execute: boolean = parseExecuteArgument(process.argv.slice(2));
  const inputPath: string = cleanupFilePath();
  const outputPath: string = seedFilePath();
  const cleanedSeed = applyIngredientCleanup(
    readCleanupSeed(outputPath),
    readCleanupCsv(inputPath),
  );
  if (!execute) {
    process.stdout.write(
      `Validated ingredient cleanup CSV. Run the same command with --execute to update '${outputPath}'.\n`,
    );
    return;
  }
  writeSeedAtomically(cleanedSeed, outputPath);
  process.stdout.write(`Updated '${outputPath}' from '${inputPath}'.\n`);
}

main();
