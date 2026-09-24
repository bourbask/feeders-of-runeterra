/**
 * What the TypeScript schema declares, read back through Drizzle itself.
 *
 * `migrations.test.ts` asks the DATABASE what exists; this file asks the
 * DECLARATION, which is the other half of the same question and the half that
 * `drizzle-kit generate` reads. It also forces the lazy pieces to evaluate:
 * every `() => other.id` foreign-key reference and every `(t) => [...]` table
 * config is a callback Drizzle only runs when somebody asks for the config, so
 * a typo in one of them would otherwise sit there unexecuted until a migration
 * was generated.
 */

import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../src/schema/index.js';
import { TABLE_NAMES } from '../src/schema/index.js';

/**
 * `SQLiteTable`'s type parameter is invariant, so a concrete table is not
 * assignable to the bare `SQLiteTable` — `getTableConfig(events)` typechecks
 * on its own but an array of them does not. The widening is done once, here,
 * rather than at each of the four call sites.
 */
const tables = Object.values(schema).filter(
  (value) => value instanceof SQLiteTable,
) as unknown as SQLiteTable[];

describe('la déclaration Drizzle', () => {
  it('porte les 21 tables, et TABLE_NAMES les nomme toutes', () => {
    const declared = tables.map((t) => getTableConfig(t).name).sort();
    expect(declared).toEqual([...TABLE_NAMES]);
  });

  it('résout chaque clé étrangère : aucune référence paresseuse cassée', () => {
    const edges = tables.flatMap((table) => {
      const config = getTableConfig(table);
      return config.foreignKeys.map((fk) => {
        const reference = fk.reference();
        return `${config.name} -> ${getTableConfig(reference.foreignTable).name}`;
      });
    });
    expect(edges.length).toBeGreaterThan(0);
    // Tout pointe vers une table du schéma, jamais vers l'extérieur.
    for (const edge of edges) {
      const target = edge.split(' -> ')[1] ?? '';
      expect(TABLE_NAMES).toContain(target);
    }
  });

  it("nomme chaque contrainte CHECK : un message d'erreur anonyme n'apprend rien", () => {
    for (const table of tables) {
      for (const contrainte of getTableConfig(table).checks) {
        expect(contrainte.name).not.toBe('');
      }
    }
  });

  it('borne events : portée obligatoire, destinataires facultatifs', () => {
    const config = getTableConfig(schema.events);
    const noms = config.checks.map((c) => c.name);
    expect(noms).toContain('events_scope_enum');
    expect(noms).toContain('events_recipients_match_scope');
    const scope = config.columns.find((c) => c.name === 'scope');
    const recipients = config.columns.find((c) => c.name === 'recipients_json');
    expect(scope?.notNull).toBe(true);
    expect(recipients?.notNull).toBe(false);
  });
});
