import { initialSchemaMigration } from './001_initial_schema.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [initialSchemaMigration];
