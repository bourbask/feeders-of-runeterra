/**
 * `@for/db` — the SQLite schema, the migrations, and opening the file.
 *
 * This file is the ONLY public surface of the package.
 */

export const NOM = '@for/db' as const;

export * from './client.js';
export * from './migrate.js';
export * from './schema-dump.js';
export * from './schema/index.js';
