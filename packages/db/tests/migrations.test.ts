/**
 * Migrating from zero, and the normalised dump that guards the DDL.
 *
 * The byte-for-byte comparison with `schema.expected.sql` is what catches a
 * migration that does not produce the DDL of 03-donnees.md section 1 — and, in
 * particular, a `CREATE TABLE events` that came back without its triggers.
 * `packages/db/src/schema-dump.ts` says what "normalised" means.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import { dumpNormalizedSchema, normalizeStatement } from '../src/schema-dump.js';
import { TABLE_NAMES } from '../src/schema/index.js';
import type { TempDb } from '../src/testing.js';
import { migratedTempDb, seedCampaign } from '../src/testing.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

function migrated(): SqliteConnection {
  const db = migratedTempDb();
  open = db;
  return db.connection;
}

describe('migration depuis une base vide', () => {
  it('crée les 21 tables de la section 1', () => {
    const connection = migrated();
    const names = (
      connection
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'
            ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual([...TABLE_NAMES]);
    expect(names).toHaveLength(21);
  });

  it('sort une base saine : integrity_check et foreign_key_check', () => {
    const connection = migrated();
    expect(connection.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(connection.pragma('foreign_key_check')).toEqual([]);
  });

  it('est idempotente : une seconde application ne fait rien', () => {
    const connection = migrated();
    const before = dumpNormalizedSchema(connection);
    const applied = connection.prepare(`SELECT count(*) AS n FROM __drizzle_migrations`).get() as {
      n: number;
    };
    expect(applied.n).toBe(1);
    expect(dumpNormalizedSchema(connection)).toBe(before);
  });

  it('pose les quatre tables WITHOUT ROWID', () => {
    const connection = migrated();
    const withoutRowid = (
      connection
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%' ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(withoutRowid).toEqual([
      'ai_turn_renders',
      'campaign_champion_locks',
      'chronicle_jobs',
      'scene_state',
    ]);
  });
});

describe('le dump normalisé', () => {
  it('est égal OCTET À OCTET à schema.expected.sql', () => {
    const connection = migrated();
    const expected = readFileSync(join(PACKAGE_ROOT, 'schema.expected.sql'), 'utf8');
    expect(dumpNormalizedSchema(connection)).toBe(expected);
  });

  it('retire les guillemets d identifiant et écrase les blancs', () => {
    expect(normalizeStatement('CREATE TABLE `t` (\n\t"a"  text\n)')).toBe(
      'CREATE TABLE t ( a text )',
    );
  });

  it("n'embarque pas la table de bookkeeping du migrateur", () => {
    const connection = migrated();
    expect(dumpNormalizedSchema(connection)).not.toContain('__drizzle_migrations');
  });
});

/**
 * The two cardinality CHECKs of `scene_state`, in both directions. Eight
 * entries is the budget the `<scene>` prompt block is sized for; a ninth is a
 * merge bug, and the transaction has to fail instead of writing it down.
 */
describe('scene_state est borné à huit présents et huit partis', () => {
  const presence = (i: number) =>
    JSON.stringify({
      ref: { kind: 'entity', id: `e${String(i)}` },
      name: 'x',
      state: '',
      sinceSeq: 1,
    });
  const absence = (i: number) =>
    JSON.stringify({
      ref: { kind: 'entity', id: `e${String(i)}` },
      name: 'x',
      cause: 'parti',
      sinceSeq: 1,
    });

  const list = (n: number, make: (i: number) => string) =>
    `[${Array.from({ length: n }, (_, i) => make(i)).join(',')}]`;

  function insertScene(connection: SqliteConnection, present: string, absent: string): void {
    connection
      .prepare(
        `INSERT INTO scene_state (campaign_id, scene_id, present_json, absent_json, updated_seq)
         VALUES ('c1', 's1', ?, ?, 1)`,
      )
      .run(present, absent);
  }

  function sceneDb(): SqliteConnection {
    const connection = migrated();
    seedCampaign(connection, { playerId: 'p1', campaignId: 'c1' });
    return connection;
  }

  it('accepte huit présents', () => {
    const connection = sceneDb();
    expect(() => {
      insertScene(connection, list(8, presence), '[]');
    }).not.toThrow();
  });

  it('refuse neuf présents', () => {
    const connection = sceneDb();
    expect(() => {
      insertScene(connection, list(9, presence), '[]');
    }).toThrow(/scene_state_present_bounded/u);
  });

  it('accepte huit partis', () => {
    const connection = sceneDb();
    expect(() => {
      insertScene(connection, '[]', list(8, absence));
    }).not.toThrow();
  });

  it('refuse neuf partis', () => {
    const connection = sceneDb();
    expect(() => {
      insertScene(connection, '[]', list(9, absence));
    }).toThrow(/scene_state_absent_bounded/u);
  });
});
