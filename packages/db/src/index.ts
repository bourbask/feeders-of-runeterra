/**
 * `@for/db` — the SQLite schema, the migrations, opening the file, and the
 * repositories that are the only write path for game state.
 *
 * This file is the ONLY public surface of the package.
 */

export const NOM = '@for/db' as const;

export * from './check.js';
export * from './client.js';
export * from './migrate.js';
export * from './rebuild.js';
export * from './repositories/index.js';
export * from './schema-dump.js';
export * from './schema/index.js';
