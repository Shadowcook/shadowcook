import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export function recipeMediaDirectory(): string {
  return resolve(process.env.SHADOWCOOK_MEDIA_DIRECTORY ?? './var/media');
}

export async function removeRecipeImageFiles(
  directory: string,
  storageKeys: string[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const storageKey of storageKeys) {
    try {
      await rm(resolve(directory, storageKey), { recursive: true, force: true });
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Recipe image files could not be removed.');
}
