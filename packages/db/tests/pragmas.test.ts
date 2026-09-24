/**
 * The seven PRAGMA of section 0.2, and the one that fails silently.
 *
 * `foreign_keys` is NOT persisted in the file. Forget it on one connection and
 * every key in the schema becomes decoration — the insert that should abort
 * succeeds instead, and the damage surfaces weeks later as orphan rows. The
 * two tests at the foot measure it IN BOTH DIRECTIONS: the same bad insert
 * raises with the PRAGMA on and succeeds with it off. A single direction would
 * only prove that an insert failed, not that this setting is what refused it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OPENING_PRAGMAS, createDb, foreignKeysAreOn, openSqlite } from '../src/client.js';
import { migrateConnection } from '../src/migrate.js';
import type { TempDb } from '../src/testing.js';
import { migratedTempDb, seedCampaign } from '../src/testing.js';

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

describe('les sept PRAGMA d ouverture', () => {
  it('en applique exactement sept, dont foreign_keys', () => {
    expect(OPENING_PRAGMAS).toHaveLength(7);
    expect(OPENING_PRAGMAS).toContain('foreign_keys = ON');
  });

  it('ouvre en WAL, avec le cache et le délai de verrou demandés', () => {
    open = migratedTempDb();
    const { connection } = open;
    expect(connection.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(connection.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(connection.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(connection.pragma('temp_store', { simple: true })).toBe(2); // MEMORY
    expect(connection.pragma('cache_size', { simple: true })).toBe(-32_000);
    expect(connection.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
    expect(foreignKeysAreOn(connection)).toBe(true);
  });

  it('repasse foreign_keys sur CHAQUE nouvelle connexion au même fichier', () => {
    open = migratedTempDb();
    const second = openSqlite(open.path);
    try {
      expect(foreignKeysAreOn(second)).toBe(true);
    } finally {
      second.close();
    }
  });

  it('expose la couche Drizzle sur une connexion déjà réglée', () => {
    open = migratedTempDb();
    const { connection, db } = createDb(open.path);
    try {
      expect(foreignKeysAreOn(connection)).toBe(true);
      expect(db).toBeDefined();
    } finally {
      connection.close();
    }
  });
});

describe('foreign_keys mord — mesuré dans les deux sens', () => {
  it('AVEC le PRAGMA : une clé étrangère invalide LÈVE', () => {
    open = migratedTempDb();
    seedCampaign(open.connection, { playerId: 'p1', campaignId: 'c1' });

    expect(() =>
      open?.connection
        .prepare(
          `INSERT INTO auth_sessions (id, player_id, created_at, last_used_at, expires_at)
           VALUES ('s1', 'joueur-inexistant', 1, 1, 2)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/u);
  });

  it('SANS le PRAGMA : la même insertion PASSE — la preuve que c est lui qui refuse', () => {
    const folder = mkdtempSync(join(tmpdir(), 'for-db-nofk-'));
    // Ouverture nue : pas de `openSqlite`, donc pas de `foreign_keys = ON`.
    const bare = openSqlite(join(folder, 'app.db'));
    try {
      migrateConnection(bare);
      bare.pragma('foreign_keys = OFF');
      expect(foreignKeysAreOn(bare)).toBe(false);

      bare
        .prepare(
          `INSERT INTO auth_sessions (id, player_id, created_at, last_used_at, expires_at)
           VALUES ('s1', 'joueur-inexistant', 1, 1, 2)`,
        )
        .run();

      const orphans = bare.prepare('SELECT count(*) AS n FROM auth_sessions').get() as {
        n: number;
      };
      expect(orphans.n).toBe(1);
    } finally {
      bare.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
