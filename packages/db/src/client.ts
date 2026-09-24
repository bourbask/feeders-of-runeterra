/**
 * Opening a SQLite file: the seven PRAGMA of 03-donnees.md section 0.2.
 *
 * ONE OF THE SEVEN FAILS SILENTLY WHEN FORGOTTEN, and it is the one that
 * matters: `foreign_keys` is NOT persisted in the file, it is a per-connection
 * setting. Forget it on one connection and every foreign key in the schema
 * becomes decoration — inserts that should abort succeed, and the damage shows
 * up much later as orphan rows. `tests/pragmas.test.ts` proves it by letting a
 * bad key raise on a connection this function opened.
 *
 * `journal_mode = WAL` is the other asymmetry, the other way round: it IS
 * persisted in the file, so re-issuing it is a no-op after the first open.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema/index.js';

/**
 * The seven PRAGMA, in the order section 0.2 prints them.
 *
 * Kept as a list rather than seven calls so that the test can assert on the
 * list itself: a PRAGMA that only exists in a doc table is not a PRAGMA.
 */
export const OPENING_PRAGMAS = [
  // Persisted in the file, issued once — but harmless to repeat.
  'journal_mode = WAL',
  'synchronous = NORMAL',
  // NOT persisted: must be reissued on EVERY connection.
  'foreign_keys = ON',
  'busy_timeout = 5000',
  'temp_store = MEMORY',
  // 32 MB of page cache.
  'cache_size = -32000',
  // ~4 MB of WAL before a checkpoint.
  'wal_autocheckpoint = 1000',
] as const;

export type SqliteConnection = Database.Database;

export interface OpenOptions {
  /** Open read-only. Used by the backup path, never by the server. */
  readonly readonly?: boolean;
}

/** Opens the file and applies the seven PRAGMA to THIS connection. */
export function openSqlite(path: string, options: OpenOptions = {}): SqliteConnection {
  const connection = new Database(path, { readonly: options.readonly ?? false });
  applyPragmas(connection);
  return connection;
}

/** Applies the seven PRAGMA to a connection someone else opened. */
export function applyPragmas(connection: SqliteConnection): void {
  for (const pragma of OPENING_PRAGMAS) {
    connection.pragma(pragma);
  }
}

/** A connection plus the Drizzle query layer bound to the 21 tables. */
export function createDb(
  path: string,
  options: OpenOptions = {},
): { connection: SqliteConnection; db: DrizzleDb } {
  const connection = openSqlite(path, options);
  return { connection, db: drizzle(connection, { schema }) };
}

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

/** Reads `foreign_keys` back. `true` means the keys on this connection bite. */
export function foreignKeysAreOn(connection: SqliteConnection): boolean {
  const rows = connection.pragma('foreign_keys') as { foreign_keys: number }[];
  return rows[0]?.foreign_keys === 1;
}
