/**
 * `db:rebuild`: zone C thrown away, the journal replayed, and the four claims
 * that make it the proof of invariant 4.
 *
 * Every guard-rail here is measured IN BOTH DIRECTIONS: the projection is
 * mutated and the rebuild is shown to undo it, a row is planted in each of the
 * six tables and shown to disappear, the journal is handed over filtered and
 * shown to raise. A test that only ran the happy path would be green on an
 * implementation that did nothing at all.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import {
  CampaignRebuildingError,
  JournalGapError,
  PROJECTION_TABLES,
  assertAcceptsIntents,
  dumpProjections,
  isRebuilding,
  rebuildAll,
  rebuildCampaign,
  replayCampaign,
  replayJournal,
} from '../src/rebuild.js';
import { UnknownCampaignError, readSince, readSinceForPlayer } from '../src/repositories/events.js';
import { settleIntentOnce } from '../src/repositories/intents.js';

import { APP_ERROR_CODES } from '@for/contracts';
import type { CampaignId } from '@for/engine';
import { anId } from '@for/testkit';
import type { Fixture } from './support/campaign.test.js';
import {
  CAMPAIGN,
  HERO,
  NOW,
  OTHER_CAMPAIGN,
  PLAYER,
  aBuiltBase,
  aSeededBase,
} from './support/campaign.test.js';

let open: Fixture | undefined;
afterEach(() => {
  open?.db.close();
  open = undefined;
});

function base(campaigns?: readonly CampaignId[]): SqliteConnection {
  const fixture = aBuiltBase(campaigns);
  open = fixture;
  return fixture.connection;
}

function seeded(campaigns?: readonly CampaignId[]): SqliteConnection {
  const fixture = aSeededBase(campaigns);
  open = fixture;
  return fixture.connection;
}

interface HeroRow {
  readonly vigueur: number;
  readonly ame: number;
  readonly momentum: number;
  readonly display_name: string;
  readonly sheet_snapshot_json: string;
  readonly created_at: number;
  readonly updated_at: number;
}

function hero(connection: SqliteConnection): HeroRow {
  return connection.prepare(`SELECT * FROM characters WHERE id = ?`).get(HERO) as HeroRow;
}

describe('the replay', () => {
  it('writes the state the journal describes, cancelled entries excluded', () => {
    const connection = base();
    const row = hero(connection);

    // seq 10 is `private` and IS applied: the projections are the server's
    // state, not one player's view.
    expect(row.vigueur).toBe(3);
    // seq 11 lowered `ame` and seq 12 cancelled it.
    expect(row.ame).toBe(5);
    expect(row.display_name).toBe('Braum');
  });

  it('fills the five other projection tables', () => {
    const connection = base();
    const count = (table: string): number =>
      (
        connection
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE campaign_id = ?`)
          .get(CAMPAIGN) as { n: number }
      ).n;

    expect(count('progress_tracks')).toBe(1);
    expect(count('clocks')).toBe(1);
    expect(count('entities')).toBe(1);
    expect(count('campaign_champion_locks')).toBe(1);
    expect(count('scene_state')).toBe(1);
  });

  it('carries the frozen sheet and the timestamps the state does not hold', () => {
    const connection = base();
    const row = hero(connection);

    expect(JSON.parse(row.sheet_snapshot_json)).toEqual({
      championId: 'braum',
      version: '1.0.0',
    });
    // `created_at` is the envelope of the entry at `created_seq` (seq 3),
    // `updated_at` that of the entry at `updated_seq` (seq 10). The fixture
    // ticks one minute per entry, so the two differ by seven minutes.
    expect(row.updated_at - row.created_at).toBe(7 * 60_000);
  });

  it('replays to the same bytes twice — idempotence', () => {
    const connection = base();
    const once = dumpProjections(connection, CAMPAIGN);
    rebuildCampaign(connection, CAMPAIGN);
    expect(dumpProjections(connection, CAMPAIGN)).toBe(once);
  });

  it('refuses a campaign it does not know', () => {
    const connection = base();
    expect(() => rebuildCampaign(connection, 'nowhere')).toThrow(UnknownCampaignError);
    expect(() => replayCampaign(connection, 'nowhere')).toThrow(UnknownCampaignError);
  });
});

describe('what a rebuild throws away', () => {
  /**
   * THE GUARD OVER `PROJECTION_TABLES`, measured rather than read.
   *
   * A row is planted in every one of the six tables and must be gone
   * afterwards. Remove a name from the list — the sixth "rule present and
   * inert" of this repository — and the table that is no longer truncated
   * keeps its row, and this test names it.
   */
  it('removes a row planted in EVERY projection table', () => {
    const connection = base();
    plantOneRowPerTable(connection);

    for (const table of PROJECTION_TABLES) {
      expect(rowsOf(connection, table)).toContain('intrus');
    }

    rebuildCampaign(connection, CAMPAIGN);

    const survivors = PROJECTION_TABLES.filter((table) =>
      rowsOf(connection, table).includes('intrus'),
    );
    expect(survivors).toEqual([]);
  });

  it('undoes a gauge written outside the reducer', () => {
    const connection = base();
    const before = dumpProjections(connection, CAMPAIGN);

    connection.prepare(`UPDATE characters SET vigueur = 0 WHERE id = ?`).run(HERO);
    expect(dumpProjections(connection, CAMPAIGN)).not.toBe(before);

    rebuildCampaign(connection, CAMPAIGN);
    expect(hero(connection).vigueur).toBe(3);
    expect(dumpProjections(connection, CAMPAIGN)).toBe(before);
  });

  it('leaves the journal and the allocator alone', () => {
    const connection = base();
    const journal = readSince(connection, CAMPAIGN, 0);
    const counter = connection.prepare(`SELECT seq FROM campaigns WHERE id = ?`).get(CAMPAIGN);

    rebuildCampaign(connection, CAMPAIGN);

    expect(readSince(connection, CAMPAIGN, 0)).toEqual(journal);
    expect(connection.prepare(`SELECT seq FROM campaigns WHERE id = ?`).get(CAMPAIGN)).toEqual(
      counter,
    );
  });
});

/** One row per projection table, all carrying the marker `intrus`. */
function plantOneRowPerTable(connection: SqliteConnection): void {
  connection
    .prepare(
      `INSERT INTO characters
         (id, campaign_id, player_id, champion_id, display_name, sheet_source, sheet_ref,
          sheet_snapshot_json, attr_vif, attr_coeur, attr_fer, attr_ombre, attr_esprit,
          status, created_seq, updated_seq, created_at, updated_at)
       VALUES ('intrus', ?, ?, 'intrus', 'intrus', 'handwritten', 'intrus', '{}',
               1, 1, 1, 1, 1, 'retired', 1, 1, ?, ?)`,
    )
    .run(CAMPAIGN, PLAYER, NOW, NOW);
  connection
    .prepare(
      `INSERT INTO progress_tracks (id, campaign_id, kind, rank, title, created_seq, updated_seq)
       VALUES ('intrus', ?, 'vow', 'genant', 'intrus', 1, 1)`,
    )
    .run(CAMPAIGN);
  connection
    .prepare(
      `INSERT INTO clocks (id, campaign_id, title, segments, created_seq, updated_seq)
       VALUES ('intrus', ?, 'intrus', 4, 1, 1)`,
    )
    .run(CAMPAIGN);
  connection
    .prepare(
      `INSERT INTO entities (id, campaign_id, kind, slug, name, first_seen_seq, last_seen_seq)
       VALUES ('intrus', ?, 'npc', 'intrus', 'intrus', 1, 1)`,
    )
    .run(CAMPAIGN);
  connection
    .prepare(
      `INSERT INTO campaign_champion_locks (campaign_id, champion_id, lock_kind, set_seq)
       VALUES (?, 'intrus', 'banned', 1)`,
    )
    .run(CAMPAIGN);
  // One row per campaign: the scene is replaced, not added to.
  connection
    .prepare(
      `INSERT INTO scene_state (campaign_id, scene_id, updated_seq) VALUES (?, 'intrus', 1)
       ON CONFLICT(campaign_id) DO UPDATE SET scene_id = 'intrus'`,
    )
    .run(CAMPAIGN);
}

/** Every text column of every row of `table`, as one string. */
function rowsOf(connection: SqliteConnection, table: string): string {
  const rows = connection
    .prepare(`SELECT * FROM ${table} WHERE campaign_id = ?`)
    .all(CAMPAIGN) as Record<string, unknown>[];
  return JSON.stringify(rows);
}

describe('ADR 0008 — the replay reads the whole journal', () => {
  /**
   * The projections are the SERVER's state. Replaying one player's thread
   * instead would quietly drop the `private` entries and rebuild a state
   * nobody ever had — so the density guard makes it loud instead.
   */
  it('raises on a player-filtered journal instead of rebuilding a state nobody had', () => {
    const connection = base();
    const whole = readSince(connection, CAMPAIGN, 0);
    const seenByAnother = readSinceForPlayer(connection, CAMPAIGN, 'p-autre', 0);

    expect(seenByAnother).toHaveLength(whole.length - 1);
    expect(() => replayJournal(CAMPAIGN, seenByAnother)).toThrow(JournalGapError);
  });

  it('gives the addressee the same thread it gives the server, minus nothing', () => {
    const connection = base();
    const whole = readSince(connection, CAMPAIGN, 0);
    expect(readSinceForPlayer(connection, CAMPAIGN, PLAYER, 0)).toHaveLength(whole.length);
  });
});

describe('one campaign at a time', () => {
  it('refuses intents on the campaign being rebuilt, and on no other', () => {
    const connection = base([CAMPAIGN, OTHER_CAMPAIGN]);
    const otherBefore = dumpProjections(connection, OTHER_CAMPAIGN);
    let observed = false;

    rebuildCampaign(connection, CAMPAIGN, {
      onLocked: () => {
        observed = true;
        expect(isRebuilding(CAMPAIGN)).toBe(true);
        expect(() => intent(connection, CAMPAIGN, 'i-1')).toThrow(CampaignRebuildingError);
        expect(intent(connection, OTHER_CAMPAIGN, 'i-2').status).toBe('rejected');
      },
    });

    expect(observed).toBe(true);
    expect(isRebuilding(CAMPAIGN)).toBe(false);
    // Nothing was written for the refused intent: the gate is before the row.
    expect(connection.prepare(`SELECT count(*) AS n FROM intents WHERE id = 'i-1'`).get()).toEqual({
      n: 0,
    });
    expect(dumpProjections(connection, OTHER_CAMPAIGN)).toBe(otherBefore);
  });

  it('releases the campaign when the replay raises', () => {
    const connection = seeded();
    // An entry the journal accepts and the schema of events refuses: the
    // replay raises inside the transaction.
    // The allocator moves FIRST: `events_seq_dense` refuses any row whose
    // `seq` is not the counter's current value.
    connection.prepare(`UPDATE campaigns SET seq = 13 WHERE id = ?`).run(CAMPAIGN);
    connection
      .prepare(
        `INSERT INTO events (id, campaign_id, seq, type, payload_json, actor_kind, scope, created_at)
         VALUES ('0EVENT00000000000000000ZZ', ?, 13, 'character.gauge_changed', '{}', 'engine', 'table', ?)`,
      )
      .run(CAMPAIGN, NOW);

    expect(() => rebuildCampaign(connection, CAMPAIGN)).toThrow();
    expect(isRebuilding(CAMPAIGN)).toBe(false);
  });

  it('rebuilds every campaign, each in its own transaction', () => {
    const connection = seeded([CAMPAIGN, OTHER_CAMPAIGN]);
    const reports = rebuildAll(connection);

    expect(reports.map((report) => report.campaignId)).toEqual([CAMPAIGN, OTHER_CAMPAIGN]);
    // Twelve entries read, eleven applied: seq 11 is cancelled by seq 12.
    expect(reports[0]).toMatchObject({ events: 12, applied: 11, seq: 12 });
    expect(dumpProjections(connection, CAMPAIGN)).not.toBe('');
    expect(dumpProjections(connection, OTHER_CAMPAIGN)).not.toBe('');
  });
});

/**
 * The two clocks the disordered fixture writes, minted OUT of key order.
 *
 * `anId('clock', 21)` ends on `N`, `anId('clock', 22)` on `P`: the first is
 * the smaller key, and it is inserted SECOND, so the physical order of the
 * table is the reverse of the order the dump must print.
 */
const CLOCK_SMALL = anId('clock', 21);
const CLOCK_LARGE = anId('clock', 22);

/**
 * Zone C written by hand, IN DISORDER, so the normalisations of
 * `dumpProjections` have something to normalise.
 *
 * Nothing here goes through the reducer on purpose: this suite measures the
 * dump, not the replay, and the replay would hand it rows already sorted —
 * the "fixture already sorted" failure that made all three sorts removable
 * with the suite still green.
 *
 * The two rows differ in `id` and `title` and in nothing else, so the order
 * the dump prints them in is decided by `id` alone and cannot be read as an
 * accident of some other column.
 */
function aDisorderedZoneC(): SqliteConnection {
  const connection = seeded();
  const insert = connection.prepare(
    `INSERT INTO clocks
       (id, campaign_id, title, description, segments, filled, status, visibility,
        consequence, created_seq, updated_seq)
     VALUES (?, ?, ?, '', 6, 0, 'ticking', 'public', 'Le col se ferme.', 7, 7)`,
  );
  insert.run(CLOCK_LARGE, CAMPAIGN, 'La tempête monte');
  insert.run(CLOCK_SMALL, CAMPAIGN, 'Le vent se lève');
  return connection;
}

/**
 * What `dumpProjections` must print for that base, to the byte.
 *
 * Six headers in the order of `PROJECTION_TABLES`; the clock rows in KEY
 * order, which is the reverse of the insertion order above; and inside each
 * line the eleven columns in ALPHABETICAL order, which is not the order the
 * table declares them in. One assertion, three normalisations — remove any
 * one of them and this string stops matching.
 */
const EXPECTED_DUMP = `# characters

# progress_tracks

# clocks
{"campaign_id":"0CAMPA1GN00000000000000001","consequence":"Le col se ferme.","created_seq":7,"description":"","filled":0,"id":"0C10CK0000000000000000000N","segments":6,"status":"ticking","title":"Le vent se lève","updated_seq":7,"visibility":"public"}
{"campaign_id":"0CAMPA1GN00000000000000001","consequence":"Le col se ferme.","created_seq":7,"description":"","filled":0,"id":"0C10CK0000000000000000000P","segments":6,"status":"ticking","title":"La tempête monte","updated_seq":7,"visibility":"public"}
# entities

# campaign_champion_locks

# scene_state

`;

describe('the dump is a canonical form', () => {
  /**
   * The fixture's own guard. If SQLite ever hands these rows back in key
   * order by itself, the three assertions below would be green on a dump that
   * normalises nothing, and this file would be back to proving nothing.
   */
  it('is fed a base SQLite really does hand back out of order', () => {
    const connection = aDisorderedZoneC();
    const raw = connection
      .prepare(`SELECT * FROM clocks WHERE campaign_id = ?`)
      .all(CAMPAIGN) as Record<string, unknown>[];

    // Rows: insertion order, which is the REVERSE of key order.
    expect(raw.map((row) => row['id'])).toEqual([CLOCK_LARGE, CLOCK_SMALL]);
    // Columns: the declaration order of 03-donnees.md, which is not the
    // alphabet — `id` before `campaign_id`, `title` before `consequence`.
    expect(Object.keys(raw[0]!)).toEqual([
      'id',
      'campaign_id',
      'title',
      'description',
      'segments',
      'filled',
      'status',
      'visibility',
      'consequence',
      'created_seq',
      'updated_seq',
    ]);
  });

  it('prints tables, rows and columns in one fixed order — to the byte', () => {
    expect(dumpProjections(aDisorderedZoneC(), CAMPAIGN)).toBe(EXPECTED_DUMP);
  });

  /**
   * And the consequence that makes the row sort load-bearing rather than
   * decorative: control 9 compares this string across a rebuild, and
   * `writeProjections` inserts sorted by key. Two rows whose physical order
   * is not their key order are exactly what the live writer produces, and
   * without the sort the comparison calls a sound base divergent.
   */
  it('gives the same bytes whichever order the rows were inserted in', () => {
    const inserted = dumpProjections(aDisorderedZoneC(), CAMPAIGN);
    open?.db.close();
    open = undefined;

    const connection = seeded();
    const insert = connection.prepare(
      `INSERT INTO clocks
         (id, campaign_id, title, description, segments, filled, status, visibility,
          consequence, created_seq, updated_seq)
       VALUES (?, ?, ?, '', 6, 0, 'ticking', 'public', 'Le col se ferme.', 7, 7)`,
    );
    insert.run(CLOCK_SMALL, CAMPAIGN, 'Le vent se lève');
    insert.run(CLOCK_LARGE, CAMPAIGN, 'La tempête monte');

    expect(dumpProjections(connection, CAMPAIGN)).toBe(inserted);
  });
});

describe('the refusal carries the protocol, not a copy of it', () => {
  /**
   * ADR 0007, fourth mode: `4011` and `campaign_rebuilding` used to be typed
   * out in `rebuild.ts`, under a comment promising they could not drift from
   * the lock. `rebuild.ts` now READS both from `@for/contracts`, so there is
   * no second copy left to drift — and the two assertions below are what
   * makes that visible from here.
   *
   * THE NAME AND THE NUMBER ARE SPELLED OUT, from `01-architecture.md`
   * section 5.5. Asserting `WS_CLOSE_CODES.campaign_rebuilding` instead would
   * be the constant compared to itself, since that is now exactly where the
   * value comes from: green whatever the protocol says. The third assertion
   * is the member-to-member one — the name against the OTHER vocabulary it
   * has to belong to, `APP_ERROR_CODES`, which is a different array in a
   * different file.
   */
  it('is the pair of section 5.5, spelled out', () => {
    const error = new CampaignRebuildingError(CAMPAIGN);

    expect(error.code).toBe('campaign_rebuilding');
    expect(error.closeCode).toBe(4011);
    expect(APP_ERROR_CODES).toContain(error.code);
  });
});

/** An intent that goes through the gate, then through the only write path. */
function intent(
  connection: SqliteConnection,
  campaignId: string,
  id: string,
): { readonly status: string } {
  assertAcceptsIntents(campaignId);
  return settleIntentOnce(
    connection,
    {
      id,
      campaignId,
      playerId: PLAYER,
      type: 'move.declare',
      payload: {},
      receivedAt: NOW,
    },
    () => ({ kind: 'reject', code: 'test' }),
  );
}
