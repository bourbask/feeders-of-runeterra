/**
 * The normalised schema dump, and what "normalised" means here.
 *
 * `schema.expected.sql` is compared BYTE FOR BYTE (section 5.4), so the
 * normalisation has to be total and boring:
 *
 *   1. read `sqlite_master`, keep tables, indexes and triggers that carry SQL;
 *   2. drop `sqlite_*` internals and `__drizzle_migrations`, which belongs to
 *      the migrator and not to our DDL;
 *   3. strip identifier quoting — backticks and double quotes — so that a
 *      change of generator style is not a schema change. String literals use
 *      single quotes and are untouched;
 *   4. collapse every run of whitespace to one space;
 *   5. sort by kind (table, then index, then trigger) and then by name, so the
 *      file does not reshuffle when a table is added.
 *
 * Point 3 is the one worth knowing about: without it, upgrading drizzle-kit
 * would look like a migration that changed the schema.
 */

import type { SqliteConnection } from './client.js';

interface MasterRow {
  readonly type: string;
  readonly name: string;
  readonly sql: string | null;
}

const KIND_ORDER = ['table', 'index', 'trigger'] as const;

/** Drizzle's own bookkeeping table. Never ours, never edited by hand. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** One normalised statement per line, newline-terminated. */
export function dumpNormalizedSchema(connection: SqliteConnection): string {
  const rows = connection
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
          AND name <> ?`,
    )
    .all(MIGRATIONS_TABLE) as MasterRow[];

  const lines = rows
    .filter((row) => (KIND_ORDER as readonly string[]).includes(row.type))
    .map((row) => ({
      rank: KIND_ORDER.indexOf(row.type as (typeof KIND_ORDER)[number]),
      name: row.name,
      text: normalizeStatement(row.sql ?? ''),
    }))
    .sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((row) => `${row.text};`);

  return `${lines.join('\n')}\n`;
}

/** Strips identifier quoting and collapses whitespace. */
export function normalizeStatement(sql: string): string {
  return sql.replaceAll('`', '').replaceAll('"', '').replaceAll(/\s+/gu, ' ').trim();
}
