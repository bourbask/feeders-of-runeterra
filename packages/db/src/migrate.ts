/**
 * Applying the migrations. Forward only (section 5.2, rule 2).
 *
 * `drizzle-kit push` is forbidden outside a developer's sandbox; CI and
 * production run this, and only this. The committed SQL files are the
 * reference — a generated migration is a draft until a human has read it,
 * because drizzle-kit knows nothing of our triggers or partial indexes.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { SqliteConnection } from './client.js';
import { openSqlite } from './client.js';

/** `packages/db/migrations`, resolved from this file rather than from cwd. */
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applies every pending migration to an already-open connection. */
export function migrateConnection(connection: SqliteConnection): void {
  migrate(drizzle(connection), { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Opens `path` with the seven PRAGMA, migrates it, and hands the file back. */
export function migrateFile(path: string): SqliteConnection {
  const connection = openSqlite(path);
  migrateConnection(connection);
  return connection;
}
