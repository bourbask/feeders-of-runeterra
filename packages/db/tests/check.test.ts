/**
 * The twelve oracles, each one measured IN BOTH DIRECTIONS.
 *
 * A green `db:check` on a sound base proves nothing on its own: an empty list
 * of controls would give exactly the same green. So every control below has a
 * base that breaks it, and the assertion names the control NUMBERS that come
 * back — nothing else would notice a control quietly dropped from the list.
 *
 * TWO OF THE TWELVE CANNOT BE BROKEN THROUGH THE WRITE PATH, and they are
 * broken here the only honest way there is:
 *
 *   - control 6 (gauge bounds) is refused by the SQL `CHECK` before any oracle
 *     could see the row, so the violation runs under
 *     `PRAGMA ignore_check_constraints`. That is what the control exists for:
 *     the day a migration loses a `CHECK`, the second line of defence is this
 *     query;
 *   - control 1 (SQLite integrity) needs the FILE damaged behind the engine's
 *     back, so the violation checkpoints the WAL, closes the file and
 *     overwrites its last page.
 *
 * Several violations light TWO controls, and that is reported rather than
 * hidden: a projection mutated by hand is a control 6 (or 7) finding AND a
 * control 9 finding, because control 9 is precisely what notices that a row
 * cannot be explained by the journal.
 */

import { closeSync, copyFileSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CheckFinding } from '../src/check.js';
import {
  CONTROL_ROSTER,
  canonicalJson,
  formatFinding,
  runIntegrityChecks,
  stateHash,
} from '../src/check.js';
import type { SqliteConnection } from '../src/client.js';
import { openSqlite } from '../src/client.js';
import { replayCampaign } from '../src/rebuild.js';
import type { Fixture } from './support/campaign.test.js';
import { CAMPAIGN, CONTENT_HASH, HERO, NOW, PLAYER, aBuiltBase } from './support/campaign.test.js';

import { anId } from '@for/testkit';

/** A campaign whose journal starts at 2. ULID-shaped, or control 10 fires too. */
const GAP_CAMPAIGN = anId('campaign', 9);
const GAP_EVENT = anId('event', 901);
const BAD_EVENT = anId('event', 902);

let open: Fixture | undefined;
afterEach(() => {
  open?.db.close();
  open = undefined;
});

function built(): SqliteConnection {
  const fixture = aBuiltBase();
  open = fixture;
  return fixture.connection;
}

/** The control numbers a run came back with, deduplicated and sorted. */
function numbers(findings: readonly CheckFinding[]): readonly number[] {
  return [...new Set(findings.map((found) => found.control))].sort((a, b) => a - b);
}

describe('the roster', () => {
  /**
   * The twelve numbers and the twelve names, SPELLED OUT from the table of
   * 03-donnees.md section 7.3 rather than derived from `CONTROLS`. A list that
   * compared itself to itself would stay green on an empty list — the failure
   * this repository has now paid for six times (ADR 0007).
   */
  it('is the twelve of section 7.3, in order', () => {
    expect(CONTROL_ROSTER).toEqual([
      { number: 1, name: 'Intégrité SQLite' },
      { number: 2, name: 'FK physiques' },
      { number: 3, name: 'FK logiques' },
      { number: 4, name: 'Densité de séquence' },
      { number: 5, name: 'Compteur cohérent' },
      { number: 6, name: 'Bornes des jauges' },
      { number: 7, name: 'Verrous de distribution' },
      { number: 8, name: 'Instantanés' },
      { number: 9, name: 'Reconstruction idempotente' },
      { number: 10, name: 'Payloads' },
      { number: 11, name: 'Chroniques' },
      { number: 12, name: 'Contenu' },
    ]);
  });
});

describe('a sound base', () => {
  it('returns no line at all', () => {
    expect(runIntegrityChecks(built())).toEqual([]);
  });

  it('stays silent when checked twice — control 9 rebuilds as it checks', () => {
    const connection = built();
    expect(runIntegrityChecks(connection)).toEqual([]);
    expect(runIntegrityChecks(connection)).toEqual([]);
  });
});

describe('each control, violated', () => {
  it('1 — a page of the file overwritten', () => {
    const fixture = aBuiltBase();
    // The WAL first: without the checkpoint the rows still live in `-wal` and
    // the copy below would be a file SQLite reads as empty.
    fixture.connection.pragma('wal_checkpoint(TRUNCATE)');
    const pageSize = fixture.connection.pragma('page_size', { simple: true }) as number;
    const pageCount = fixture.connection.pragma('page_count', { simple: true }) as number;

    const folder = mkdtempSync(join(tmpdir(), 'for-db-corrompu-'));
    const path = join(folder, 'app.db');
    copyFileSync(fixture.db.path, path);
    fixture.db.close();

    const file = openSync(path, 'r+');
    writeSync(file, Buffer.alloc(pageSize, 0xff), 0, pageSize, pageSize * (pageCount - 1));
    closeSync(file);

    const damaged = openSqlite(path);
    try {
      expect(numbers(runIntegrityChecks(damaged))).toContain(1);
    } finally {
      damaged.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('2 — a physical foreign key with no target', () => {
    const connection = built();
    connection.pragma('foreign_keys = OFF');
    connection
      .prepare(
        `INSERT INTO characters
           (id, campaign_id, player_id, champion_id, display_name, sheet_source, sheet_ref,
            sheet_snapshot_json, attr_vif, attr_coeur, attr_fer, attr_ombre, attr_esprit,
            created_seq, updated_seq, created_at, updated_at)
         VALUES ('orphelin', 'campagne-fantome', ?, 'x', 'x', 'handwritten', 'x', '{}',
                 1, 1, 1, 1, 1, 1, 1, ?, ?)`,
      )
      .run(PLAYER, NOW, NOW);
    connection.pragma('foreign_keys = ON');

    expect(numbers(runIntegrityChecks(connection))).toEqual([2]);
  });

  it('3 — a logical foreign key with no target', () => {
    const connection = built();
    connection
      .prepare(
        `INSERT INTO campaign_members
           (id, campaign_id, player_id, role, character_id, joined_at, created_at, updated_at)
         VALUES ('m1', ?, ?, 'player', 'personnage-fantome', ?, ?, ?)`,
      )
      .run(CAMPAIGN, PLAYER, NOW, NOW, NOW);

    expect(numbers(runIntegrityChecks(connection))).toEqual([3]);
  });

  it('4 — a journal that does not start at 1', () => {
    const connection = built();
    connection
      .prepare(
        `INSERT INTO campaigns
           (id, slug, name, owner_player_id, content_pack_version, content_pack_hash,
            rules_version, reducer_version, rng_seed, seq, created_at, updated_at)
         VALUES (?, 'slug-trou', 'trou', ?, '1.0.0', ?, 1, 1, 'x', 2, ?, ?)`,
      )
      .run(GAP_CAMPAIGN, PLAYER, CONTENT_HASH, NOW, NOW);
    connection
      .prepare(
        `INSERT INTO events (id, campaign_id, seq, type, payload_json, actor_kind, scope, created_at)
         VALUES (?, ?, 2, 'system.note', ?, 'system', 'table', ?)`,
      )
      .run(
        GAP_EVENT,
        GAP_CAMPAIGN,
        JSON.stringify({ text: 'seule entrée', byPlayerId: PLAYER }),
        NOW,
      );

    // 9 comes with it: a journal with a hole cannot be replayed, and saying so
    // is the control doing its job.
    expect(numbers(runIntegrityChecks(connection))).toEqual([4, 9]);
  });

  it('5 — the allocator ahead of the journal', () => {
    const connection = built();
    connection.prepare(`UPDATE campaigns SET seq = seq + 1 WHERE id = ?`).run(CAMPAIGN);

    expect(numbers(runIntegrityChecks(connection))).toEqual([5]);
  });

  it('6 — a gauge out of bounds, written with the CHECK constraints off', () => {
    const connection = built();
    connection.pragma('ignore_check_constraints = ON');
    connection.prepare(`UPDATE characters SET vigueur = 42 WHERE id = ?`).run(HERO);
    connection.pragma('ignore_check_constraints = OFF');

    // THREE controls, and the third one is a finding about the tooling: on
    // this engine `PRAGMA integrity_check` reports a broken `CHECK` too, so
    // control 1 speaks up as well. Written out rather than loosened to
    // `toContain(6)`, which would have hidden it.
    expect(numbers(runIntegrityChecks(connection))).toEqual([1, 6, 9]);
  });

  it('7 — a non-player character wearing a reserved champion', () => {
    const connection = built();
    connection
      .prepare(`UPDATE entities SET champion_id = 'braum' WHERE campaign_id = ?`)
      .run(CAMPAIGN);

    expect(numbers(runIntegrityChecks(connection))).toEqual([7, 9]);
  });

  it('8 — a snapshot whose hash the replay does not reproduce', () => {
    const connection = built();
    insertSnapshot(connection, 'instantane-faux', 12, 'sha256-de-personne');

    expect(numbers(runIntegrityChecks(connection))).toEqual([8]);
  });

  it('9 — a projection mutated outside the reducer', () => {
    const connection = built();
    connection.prepare(`UPDATE characters SET vigueur = 0 WHERE id = ?`).run(HERO);

    const findings = runIntegrityChecks(connection);
    expect(numbers(findings)).toEqual([9]);
    // The whole line, not a fragment of it. `firstDifference` and its two
    // helpers are thirty lines whose entire point is the tail — "vigueur
    // 0 -> 3", the column and the two values that send you to the write that
    // had no event behind it. Asserting only "contrôle 9" left those thirty
    // lines replaceable by a constant string with the suite still green.
    //
    // Both numbers are spelled out rather than read back: 0 is what the
    // violation above writes, 3 is what the journal says (5 at creation,
    // -2 at seq 10). Neither comes from the code under test.
    expect(formatFinding(findings[0]!)).toBe(
      `contrôle 9 — Reconstruction idempotente [${CAMPAIGN}] : ` +
        `projections divergentes après reconstruction : vigueur 0 -> 3`,
    );
  });

  it('10 — a payload the event schema refuses', () => {
    const connection = built();
    connection.prepare(`UPDATE campaigns SET seq = 13 WHERE id = ?`).run(CAMPAIGN);
    connection
      .prepare(
        `INSERT INTO events (id, campaign_id, seq, type, payload_json, actor_kind, scope, created_at)
         VALUES (?, ?, 13, 'character.gauge_changed', '{}', 'engine', 'table', ?)`,
      )
      .run(BAD_EVENT, CAMPAIGN, NOW);

    // 9 again, and for the same reason: the replay stops on that entry.
    expect(numbers(runIntegrityChecks(connection))).toEqual([9, 10]);
  });

  it('11 — a chronicle version that skips 1', () => {
    const connection = built();
    insertChronicle(connection, 'chr-2', 2, 5);

    expect(numbers(runIntegrityChecks(connection))).toEqual([11]);
  });

  it('11 — a source_event_seq that does not grow with the version', () => {
    const connection = built();
    insertChronicle(connection, 'chr-1', 1, 8);
    insertChronicle(connection, 'chr-2', 2, 8);

    expect(numbers(runIntegrityChecks(connection))).toEqual([11]);
  });

  it('11 — a source_event_seq beyond the allocator', () => {
    const connection = built();
    insertChronicle(connection, 'chr-1', 1, 99);

    expect(numbers(runIntegrityChecks(connection))).toEqual([11]);
  });

  it('12 — a content pack the base does not know', () => {
    const connection = built();
    connection
      .prepare(`UPDATE campaigns SET content_pack_hash = 'sha256-inconnu' WHERE id = ?`)
      .run(CAMPAIGN);

    expect(numbers(runIntegrityChecks(connection))).toEqual([12]);
  });
});

describe('the snapshot oracle, in the green direction', () => {
  it('accepts a snapshot the replay reproduces', () => {
    const connection = built();
    const hash = stateHash(replayCampaign(connection, CAMPAIGN).state);
    insertSnapshot(connection, 'instantane-vrai', 12, hash);

    expect(runIntegrityChecks(connection)).toEqual([]);
  });

  /**
   * The acceptance criterion, word for word: delete a snapshot, rebuild,
   * check. A snapshot is a cache of a cache; losing one costs a longer replay
   * and nothing else.
   */
  it('stays green once that snapshot is deleted', () => {
    const connection = built();
    const hash = stateHash(replayCampaign(connection, CAMPAIGN).state);
    insertSnapshot(connection, 'instantane-vrai', 12, hash);
    connection.prepare(`DELETE FROM snapshots WHERE id = 'instantane-vrai'`).run();

    expect(runIntegrityChecks(connection)).toEqual([]);
  });
});

describe('the canonical bytes a state_hash is taken over', () => {
  it('does not depend on the order the keys were written in', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, null] } })).toBe(
      '{"a":{"c":[3,null],"d":2},"b":1}',
    );
    expect(stateHash({ a: 1, b: 2 })).toBe(stateHash({ b: 2, a: 1 }));
  });

  it('gives a different hash for a different state', () => {
    expect(stateHash({ a: 1 })).not.toBe(stateHash({ a: 2 }));
  });
});

function insertSnapshot(connection: SqliteConnection, id: string, seq: number, hash: string): void {
  connection
    .prepare(
      `INSERT INTO snapshots
         (id, campaign_id, seq, reducer_version, state_json, state_hash, size_bytes, kind, created_at)
       VALUES (?, ?, ?, 1, '{}', ?, 2, 'rolling', ?)`,
    )
    .run(id, CAMPAIGN, seq, hash, NOW);
}

function insertChronicle(
  connection: SqliteConnection,
  id: string,
  version: number,
  sourceEventSeq: number,
): void {
  connection
    .prepare(
      `INSERT INTO chronicles
         (id, campaign_id, version, kind, source_event_seq, doc_json, rendered_md,
          token_count, model, prompt_version, created_at)
       VALUES (?, ?, ?, 'handwritten', ?, '{}', '', 0, 'aucun', '1.0.0', ?)`,
    )
    .run(id, CAMPAIGN, version, sourceEventSeq, NOW);
}
