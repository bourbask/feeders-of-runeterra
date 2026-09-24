/**
 * `pnpm db:rebuild` — zone C thrown away and replayed from the journal.
 *
 * THIS FILE IS THE PROOF OF INVARIANT 4: the projections are disposable. If a
 * row of `characters` can only be explained by a write that happened outside
 * the reducer, throwing the table away and replaying gives different bytes,
 * and control 9 of `db:check` says so (`check.ts`).
 *
 * ── WHAT IS TRUNCATED, AND WHAT IS NOT ───────────────────────────────────
 * `PROJECTION_TABLES` is zone C of 03-donnees.md section 0.4 MINUS
 * `snapshots`. A snapshot is a cache too, but it is the INPUT of control 8,
 * not an output of this file: nothing here can recreate one, so deleting them
 * would destroy evidence instead of rebuilding it. A missing snapshot costs a
 * longer replay and nothing else, which is why the acceptance criterion
 * "delete a snapshot, rebuild, check" comes back green.
 *
 * That list is a loop source, and a loop source that shrinks in silence is a
 * guard-rail that stops guarding (the sixth one this repository has paid for).
 * So it is not measured by reading it: `tests/rebuild.test.ts` writes a row
 * INTO EVERY ONE of the six tables and asserts the rebuild removed it. Drop a
 * name from the list and that test goes red on the table that survived.
 *
 * ── THE JOURNAL IS READ WHOLE, AND ADR 0008 IS WHY IT MATTERS ────────────
 * Since ADR 0008 an entry carries `scope` and `recipients`: a `private` event
 * reaches one player. The projections are the SERVER'S state, so the replay
 * reads `readSince` — every entry, whoever saw it — never
 * `readSinceForPlayer`. Swapping one for the other would silently drop the
 * addressed entries and rebuild a state nobody ever had.
 *
 * "Silently" is what the density guard exists to prevent: `replayJournal`
 * requires `seq` to be 1, 2, 3 … with no hole, so a player-filtered stream
 * raises `JournalGapError` at the first entry it was not shown.
 * `tests/rebuild.test.ts` measures exactly that, by replaying the filtered
 * read and catching the raise.
 *
 * ── TWO COLUMNS THE REDUCER CANNOT GIVE, DECLARED ────────────────────────
 * `characters` has three columns that are not in `CharacterState`:
 *
 *   - `sheet_snapshot_json`, the champion sheet FROZEN at creation. The
 *     reducer reads `character.created` and keeps `championId`, `source` and
 *     `ref` — it drops `payload.sheetSnapshot`. The column is `NOT NULL` and
 *     the frozen sheet is real data, so the value is taken FROM THE JOURNAL
 *     during the same pass, never from the content pack of the day. It stays
 *     a function of the journal alone (invariant 4), but it does travel beside
 *     the reducer rather than through it. SIGNALLED, not worked around: the
 *     clean fix is `sheetSnapshot` on `CharacterState`, in `@for/engine`,
 *     which is not this task's package.
 *   - `created_at` / `updated_at`, which the state has no room for either.
 *     They are read off the envelope of the entry at `createdSeq` /
 *     `updatedSeq` — again the journal, and again reproducible.
 *
 * `bonds_json`, `notes_json` and `portrait_url` have no event that feeds them
 * yet; they are written at their DDL default, which is what a replay of a
 * journal that never mentions them must produce.
 *
 * ── A DECLARED DIVERGENCE FROM `ARCHITECTURE.md` SECTION 5 ───────────────
 * That table lists the runtime dependencies of `@for/db` as `drizzle-orm`,
 * `better-sqlite3` and `@for/contracts`. Rebuilding needs `reduce`, which
 * lives in `@for/engine`, so `@for/engine` moves from `devDependencies` to
 * `dependencies` here. It is the spec's own file layout that requires it —
 * `01-architecture.md` section 2.6 puts `rebuild.ts` in this package — and no
 * `dependency-cruiser` rule forbids the edge, which is why this is a report
 * and not a request. `docs/` is not this task's to edit.
 *
 * ── ZONE A IS NOT TOUCHED ────────────────────────────────────────────────
 * `campaigns` is zone A: its rows ARE the truth, backup included, and `seq` is
 * the allocator. A rebuild that wrote `campaigns.truths_json` — derivable as
 * it is — would be writing outside its zone and could not be run on a live
 * campaign. So `truths` stays in the replayed `CampaignState` and stops there.
 */

import type { SqliteConnection } from './client.js';
import { campaignSeq } from './repositories/campaigns.js';
import { UnknownCampaignError, readSince } from './repositories/events.js';
import type { JournalEvent } from './repositories/rows.js';

import { upcast, zGameEvent } from '@for/contracts';
import type { CampaignId, CampaignState, GameEvent, PlayerId } from '@for/engine';
import {
  REDUCER_VERSION,
  collectRevertedSeqs,
  createInitialCampaignState,
  reduceAll,
} from '@for/engine';

/**
 * Zone C, minus `snapshots`. Truncated in this order, which is the order
 * `dumpProjections` prints them in — a dump that reshuffled would compare
 * differently for no reason.
 */
export const PROJECTION_TABLES = [
  'characters',
  'progress_tracks',
  'clocks',
  'entities',
  'campaign_champion_locks',
  'scene_state',
] as const;

export type ProjectionTable = (typeof PROJECTION_TABLES)[number];

/** Raised when the journal has a hole: `seq` did not go 1, 2, 3 … */
export class JournalGapError extends Error {
  constructor(
    readonly campaignId: string,
    readonly expectedSeq: number,
    readonly foundSeq: number,
  ) {
    super(
      `journal troué sur ${campaignId} : seq ${String(foundSeq)} là où ${String(expectedSeq)} était attendu`,
    );
    this.name = 'JournalGapError';
  }
}

/**
 * Raised when an intent arrives for a campaign whose projections are being
 * rebuilt.
 *
 * `closeCode` is the WebSocket code of `01-architecture.md` section 5:
 * `4011 campaign_rebuilding`. It is carried here rather than in the server so
 * that the refusal and the lock that causes it cannot drift apart.
 */
export class CampaignRebuildingError extends Error {
  readonly code = 'campaign_rebuilding';
  readonly closeCode = 4011;

  constructor(readonly campaignId: string) {
    super(`campagne ${campaignId} en cours de reconstruction`);
    this.name = 'CampaignRebuildingError';
  }
}

/**
 * The campaigns being rebuilt right now, in this process.
 *
 * A module-level set is enough and is not a shortcut: section 0.3 makes the
 * process the single writer, and a rebuild runs inside ONE synchronous
 * transaction. A row in the database would be a second source of truth for a
 * state that cannot outlive the process holding it.
 */
const rebuilding = new Set<string>();

/** `true` while `rebuildCampaign` is inside that campaign's transaction. */
export function isRebuilding(campaignId: string): boolean {
  return rebuilding.has(campaignId);
}

/**
 * The gate the intent path calls before writing. Refuses ONE campaign and
 * leaves every other one alone.
 */
export function assertAcceptsIntents(campaignId: string): void {
  if (rebuilding.has(campaignId)) {
    throw new CampaignRebuildingError(campaignId);
  }
}

/** Runs `body` with that campaign marked as rebuilding, released on any exit. */
export function withRebuildLock<T>(campaignId: string, body: () => T): T {
  if (rebuilding.has(campaignId)) {
    throw new CampaignRebuildingError(campaignId);
  }
  rebuilding.add(campaignId);
  try {
    return body();
  } finally {
    rebuilding.delete(campaignId);
  }
}

/** What a replay produced: the state, plus the two things the state drops. */
export interface ReplayResult {
  readonly state: CampaignState;
  /** `createdAt` of the entry at each `seq`. Feeds the character timestamps. */
  readonly createdAtBySeq: ReadonlyMap<number, number>;
  /** Frozen champion sheet per character, taken from `character.created`. */
  readonly sheetSnapshots: ReadonlyMap<string, unknown>;
  /** Entries skipped because a `system.reverted` named them. */
  readonly revertedSeqs: ReadonlySet<number>;
}

/**
 * The journal, played back into a `CampaignState`.
 *
 * Takes a list rather than a connection so that a test can hand it a stream
 * that is NOT the whole journal — which is how the density guard gets measured
 * instead of being asserted.
 */
export function replayJournal(campaignId: string, events: readonly JournalEvent[]): ReplayResult {
  const createdAtBySeq = new Map<number, number>();
  const sheetSnapshots = new Map<string, unknown>();
  const journal: GameEvent[] = [];
  let expected = 1;

  for (const row of events) {
    if (row.seq !== expected) {
      throw new JournalGapError(campaignId, expected, row.seq);
    }
    expected += 1;
    createdAtBySeq.set(row.seq, row.createdAt);

    const { payload, payloadVersion } = upcast({
      type: row.type,
      payloadVersion: row.payloadVersion,
      payload: row.payload,
    });
    const event = zGameEvent.parse({ ...row, payload, payloadVersion }) as GameEvent;

    if (event.type === 'character.created') {
      sheetSnapshots.set(event.payload.characterId, event.payload.sheetSnapshot);
    }
    journal.push(event);
  }

  // `reduceAll`, not a loop of `reduce`: a cancelled entry must still advance
  // its draw stream (03-donnees.md section 3.6), and that rule lives in the
  // engine. Rewriting the replay here would be a second reducer — the exact
  // second write path ARCHITECTURE.md section 6 refuses.
  const state = reduceAll(
    createInitialCampaignState({
      campaignId: campaignId as CampaignId,
      ownerPlayerId: '' as PlayerId,
    }),
    journal,
  );

  return { state, createdAtBySeq, sheetSnapshots, revertedSeqs: collectRevertedSeqs(journal) };
}

/** Reads the whole journal of one campaign and replays it. */
export function replayCampaign(connection: SqliteConnection, campaignId: string): ReplayResult {
  if (campaignSeq(connection, campaignId) === undefined) {
    throw new UnknownCampaignError(campaignId);
  }
  return replayJournal(campaignId, readSince(connection, campaignId, 0));
}

function deleteProjections(connection: SqliteConnection, campaignId: string): void {
  for (const table of PROJECTION_TABLES) {
    connection.prepare(`DELETE FROM ${table} WHERE campaign_id = ?`).run(campaignId);
  }
}

const INSERT_CHARACTER = `INSERT INTO characters
  (id, campaign_id, player_id, champion_id, display_name, sheet_source, sheet_ref,
   sheet_snapshot_json, attr_vif, attr_coeur, attr_fer, attr_ombre, attr_esprit,
   vigueur, ame, vivres, momentum, momentum_max, momentum_reset, xp_earned, xp_spent,
   conditions_json, assets_json, bonds_json, notes_json, status, created_seq, updated_seq,
   created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}',
          ?, ?, ?, ?, ?)`;

const INSERT_TRACK = `INSERT INTO progress_tracks
  (id, campaign_id, kind, rank, title, description, owner_character_id, ticks, status,
   visibility, tags_json, created_seq, updated_seq, resolved_seq)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_CLOCK = `INSERT INTO clocks
  (id, campaign_id, title, description, segments, filled, status, visibility, consequence,
   created_seq, updated_seq)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_ENTITY = `INSERT INTO entities
  (id, campaign_id, kind, slug, name, summary, details_json, champion_id, region_id, status,
   disposition, first_seen_seq, last_seen_seq)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_LOCK = `INSERT INTO campaign_champion_locks
  (campaign_id, champion_id, lock_kind, reason, set_seq) VALUES (?, ?, ?, ?, ?)`;

const INSERT_SCENE = `INSERT INTO scene_state
  (campaign_id, scene_id, place_id, place_name, time_of_day, present_json, absent_json,
   updated_seq)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The replayed state, written back into zone C.
 *
 * Rows are written in identifier order so that two rebuilds of the same
 * journal produce the same file, page for page — `characters` has a rowid, and
 * insertion order is what decides it.
 */
function writeProjections(
  connection: SqliteConnection,
  campaignId: string,
  replay: ReplayResult,
): void {
  const { state } = replay;
  const at = (seq: number): number => replay.createdAtBySeq.get(seq) ?? 0;

  for (const character of [...Object.values(state.characters)].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    connection
      .prepare(INSERT_CHARACTER)
      .run(
        character.id,
        campaignId,
        character.playerId,
        character.championId,
        character.displayName,
        character.sheet.source,
        character.sheet.ref,
        JSON.stringify(replay.sheetSnapshots.get(character.id) ?? {}),
        character.attributes.vif,
        character.attributes.coeur,
        character.attributes.fer,
        character.attributes.ombre,
        character.attributes.esprit,
        character.gauges.vigueur,
        character.gauges.ame,
        character.gauges.vivres,
        character.momentum,
        character.momentumBounds.max,
        character.momentumBounds.reset,
        character.xpEarned,
        character.xpSpent,
        JSON.stringify(character.conditions),
        JSON.stringify(character.assets),
        character.status,
        character.createdSeq,
        character.updatedSeq,
        at(character.createdSeq),
        at(character.updatedSeq),
      );
  }

  for (const track of [...Object.values(state.tracks)].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    connection
      .prepare(INSERT_TRACK)
      .run(
        track.id,
        campaignId,
        track.kind,
        track.rank,
        track.title,
        track.description,
        track.ownerCharacterId,
        track.ticks,
        track.status,
        track.visibility,
        JSON.stringify(track.tags),
        track.createdSeq,
        track.updatedSeq,
        track.resolvedSeq,
      );
  }

  for (const clock of [...Object.values(state.clocks)].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    connection
      .prepare(INSERT_CLOCK)
      .run(
        clock.id,
        campaignId,
        clock.title,
        clock.description,
        clock.segments,
        clock.filled,
        clock.status,
        clock.visibility,
        clock.consequence,
        clock.createdSeq,
        clock.updatedSeq,
      );
  }

  for (const entity of [...Object.values(state.entities)].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    connection
      .prepare(INSERT_ENTITY)
      .run(
        entity.id,
        campaignId,
        entity.kind,
        entity.slug,
        entity.name,
        entity.summary,
        JSON.stringify(entity.details),
        entity.championId,
        entity.regionId,
        entity.status,
        entity.disposition,
        entity.firstSeenSeq,
        entity.lastSeenSeq,
      );
  }

  for (const lock of [...Object.values(state.championLocks)].sort((a, b) =>
    a.championId < b.championId ? -1 : a.championId > b.championId ? 1 : 0,
  )) {
    connection
      .prepare(INSERT_LOCK)
      .run(campaignId, lock.championId, lock.lockKind, lock.reason, lock.setSeq);
  }

  if (state.scene !== null) {
    connection
      .prepare(INSERT_SCENE)
      .run(
        campaignId,
        state.scene.sceneId,
        state.scene.placeId,
        state.scene.placeName,
        state.scene.timeOfDay,
        JSON.stringify(state.scene.present),
        JSON.stringify(state.scene.absent),
        state.scene.updatedSeq,
      );
  }
}

export interface RebuildReport {
  readonly campaignId: string;
  /** Entries read, cancelled ones included. */
  readonly events: number;
  /** Entries the reducer actually applied. */
  readonly applied: number;
  readonly reducerVersion: number;
  /** `seq` of the last entry applied. Equal to the allocator on a sound base. */
  readonly seq: number;
}

/**
 * One campaign, one transaction (`BEGIN IMMEDIATE`).
 *
 * All or nothing: a replay that raises half way leaves zone C exactly as it
 * was. The campaign is refused intents from the moment the lock is taken to
 * the moment the transaction ends, and NO other campaign is affected — neither
 * its rows, which are never touched, nor its intents, which the gate lets
 * through.
 */
export function rebuildCampaign(
  connection: SqliteConnection,
  campaignId: string,
  options: {
    /**
     * Called once the campaign is locked and before anything is written. This
     * is what the server hooks to close the sockets of that table with 4011,
     * and the only place a test can observe a state that exists for the length
     * of one synchronous transaction.
     */
    readonly onLocked?: (campaignId: string) => void;
  } = {},
): RebuildReport {
  if (campaignSeq(connection, campaignId) === undefined) {
    throw new UnknownCampaignError(campaignId);
  }

  return withRebuildLock(campaignId, () => {
    options.onLocked?.(campaignId);
    const run = connection.transaction((): RebuildReport => {
      const replay = replayCampaign(connection, campaignId);
      deleteProjections(connection, campaignId);
      writeProjections(connection, campaignId, replay);
      return {
        campaignId,
        events: replay.createdAtBySeq.size,
        applied: replay.createdAtBySeq.size - replay.revertedSeqs.size,
        reducerVersion: REDUCER_VERSION,
        seq: replay.state.seq,
      };
    });
    return run.immediate();
  });
}

/** Every campaign, oldest first, each in its own transaction. */
export function rebuildAll(connection: SqliteConnection): readonly RebuildReport[] {
  const rows = connection.prepare(`SELECT id FROM campaigns ORDER BY id`).all() as {
    id: string;
  }[];
  return rows.map((row) => rebuildCampaign(connection, row.id));
}

/**
 * Zone C of one campaign, as bytes.
 *
 * Control 9 compares this string before and after a rebuild, so it must depend
 * on the CONTENT of the rows and on nothing else: columns are read by name and
 * sorted, rows are ordered by their key, and tables come in the order of
 * `PROJECTION_TABLES`. A `SELECT *` in declaration order would have made a
 * column rename look like a divergence.
 */
export function dumpProjections(connection: SqliteConnection, campaignId: string): string {
  const parts: string[] = [];
  for (const table of PROJECTION_TABLES) {
    const rows = connection
      .prepare(`SELECT * FROM ${table} WHERE campaign_id = ?`)
      .all(campaignId) as Record<string, unknown>[];
    const lines = rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries([...Object.entries(row)].sort(([a], [b]) => (a < b ? -1 : 1))),
        ),
      )
      .sort();
    parts.push(`# ${table}\n${lines.join('\n')}\n`);
  }
  return parts.join('');
}
