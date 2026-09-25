/**
 * Snapshots: the cache that bounds a replay, and the two ways of loading a
 * campaign — which are NOT the same load, for a reason worth stating.
 *
 * 03-donnees.md section 3.5 sets the goal: "ne jamais rejouer plus de ~500
 * evenements", with a `rolling` snapshot every 200, a `session_end` one on
 * `session.closed`, and a `milestone` one when a vow of rank `redoutable` or
 * above resolves.
 *
 * ── THE TWO LOADS, AND WHY THE WRITE PATH CANNOT USE A SNAPSHOT ───────────
 * `loadState` reads the best compatible snapshot and replays only the tail.
 * That is enough for a READER: `getSnapshot` projects a `CampaignState` into
 * a `TableStateDto` and needs nothing else.
 *
 * `loadReplay` replays the WHOLE journal, and the write path uses it. A
 * snapshot carries `CampaignState` and `CampaignState` alone; rewriting zone C
 * needs two things the state does not hold — the `created_at` of every entry,
 * which becomes `characters.created_at` / `updated_at`, and the frozen sheet
 * of each `character.created`, which becomes `sheet_snapshot_json`. Both are
 * journal facts the reducer drops on purpose. Accelerating the write path
 * would therefore mean either widening the snapshot payload (a schema change,
 * so an ADR) or writing projections from a second source. Neither is M0-24's
 * to decide, so the cost is paid and reported rather than worked around: on
 * the demonstration campaign (248 entries) the full replay is milliseconds,
 * and M1 has a measurement to make before it is anything else.
 *
 * ── A STALE SNAPSHOT CANNOT SURVIVE ──────────────────────────────────────
 * `revertTurn` deletes every snapshot at `seq >= min(targetSeqs)` (section
 * 3.7, point 1), so a snapshot that is still there is always older than every
 * cancelled entry, and the tail replay — `reduceAll`, which runs its own
 * two-pass over what it is given — sees every `system.reverted` that concerns
 * it. Measured in `tests/game/revert.test.ts`, not assumed.
 */

import { zCampaignState } from '@for/contracts';
import { canonicalJson, replayCampaign, stateHash } from '@for/db';
import { REDUCER_VERSION, createInitialCampaignState, reduceAll } from '@for/engine';

import type { ReplayResult, SqliteConnection } from '@for/db';
import type { CampaignId, CampaignState, GameEvent, PlayerId, ProgressRank } from '@for/engine';

/** Every 200 entries, `rolling` (03-donnees.md section 3.5). */
export const ROLLING_SNAPSHOT_EVERY = 200;

/** How many `rolling` snapshots a campaign keeps. The older ones are dropped. */
export const ROLLING_SNAPSHOT_KEPT = 3;

/**
 * The rank from which a resolved vow is worth a permanent snapshot.
 *
 * Written as the NAME from section 3.5 and compared through the engine's own
 * ordered tuple below, so the threshold is one value in one place. A number
 * here would be a second spelling of the rank ladder.
 */
export const MILESTONE_SNAPSHOT_MIN_RANK: ProgressRank = 'redoutable';

/** The ladder, ordered. `PROGRESS_RANKS` in `@for/engine` is the same tuple. */
const RANK_ORDER: readonly ProgressRank[] = [
  'genant',
  'dangereux',
  'redoutable',
  'extreme',
  'epique',
];

export type SnapshotKind = 'rolling' | 'milestone' | 'session_end';

interface SnapshotRow {
  readonly seq: number;
  readonly state_json: string;
}

/**
 * The best snapshot at or below `head`, for the CURRENT reducer version.
 *
 * The `reducer_version` filter is what makes a `REDUCER_VERSION` bump safe
 * without a data migration (section 3.5, "Invalidations"): older snapshots
 * simply stop being selected.
 */
function bestSnapshot(
  connection: SqliteConnection,
  campaignId: string,
  head: number,
): SnapshotRow | undefined {
  return connection
    .prepare(
      `SELECT seq, state_json FROM snapshots
        WHERE campaign_id = ? AND reducer_version = ? AND seq <= ?
        ORDER BY seq DESC LIMIT 1`,
    )
    .get(campaignId, REDUCER_VERSION, head) as SnapshotRow | undefined;
}

/**
 * One campaign's state, read through the snapshot cache.
 *
 * READ PATH ONLY — see the header. A missing or unusable snapshot costs a
 * longer replay and nothing else, which is section 3.5's own promise: "un
 * instantane manquant ne coute qu'un rejeu plus long, jamais une erreur".
 */
export function loadState(
  connection: SqliteConnection,
  campaignId: string,
  head: number,
  readSince: (afterSeq: number) => readonly GameEvent[],
): CampaignState {
  const snapshot = bestSnapshot(connection, campaignId, head);
  const base =
    snapshot === undefined
      ? createInitialCampaignState({
          campaignId: campaignId as CampaignId,
          ownerPlayerId: '' as PlayerId,
        })
      : (zCampaignState.parse(JSON.parse(snapshot.state_json)) as CampaignState);
  return reduceAll(base, readSince(snapshot?.seq ?? 0));
}

/**
 * The whole journal, replayed, with the two maps a snapshot cannot carry.
 *
 * WRITE PATH — see the header. Thin by design: the replay itself belongs to
 * `@for/db`, which owns the density guard and the upcasters, and a second
 * replay here would be the second reducer ARCHITECTURE.md section 6 refuses.
 */
export function loadReplay(connection: SqliteConnection, campaignId: string): ReplayResult {
  return replayCampaign(connection, campaignId);
}

// ------------------------------------------------------------- the policy

export interface SnapshotDue {
  readonly kind: SnapshotKind;
  readonly seq: number;
}

/**
 * Does the batch that was just committed call for a snapshot, and of what kind?
 *
 * `state` is the state AFTER the batch, because a `milestone` needs the rank
 * of the track that just resolved and only the state carries it.
 *
 * ONE SNAPSHOT PER BATCH AT MOST, and the permanent kinds win: a
 * `session.closed` that also crosses a multiple of 200 is worth keeping
 * forever, and writing both would put two rows at the same `seq`, which the
 * unique index refuses anyway.
 */
export function snapshotDue(
  state: CampaignState,
  events: readonly GameEvent[],
): SnapshotDue | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;

  for (const event of events) {
    if (event.type === 'session.closed') return { kind: 'session_end', seq: last.seq };
  }
  for (const event of events) {
    if (event.type !== 'track.resolved') continue;
    const track = state.tracks[event.payload.trackId];
    if (track?.kind !== 'vow') continue;
    if (RANK_ORDER.indexOf(track.rank) >= RANK_ORDER.indexOf(MILESTONE_SNAPSHOT_MIN_RANK)) {
      return { kind: 'milestone', seq: last.seq };
    }
  }

  // Crossed a multiple of 200 somewhere inside the batch. Written as a
  // comparison of two floors rather than a modulo on the last sequence: a
  // batch of five entries can straddle the boundary without landing on it.
  const first = events[0];
  if (first === undefined) return null;
  const before = Math.floor((first.seq - 1) / ROLLING_SNAPSHOT_EVERY);
  const after = Math.floor(last.seq / ROLLING_SNAPSHOT_EVERY);
  return after > before ? { kind: 'rolling', seq: last.seq } : null;
}

export interface SnapshotWriteInput {
  readonly campaignId: string;
  readonly state: CampaignState;
  readonly due: SnapshotDue;
  readonly id: string;
  readonly now: number;
}

/**
 * Writes the snapshot and applies the retention of section 3.5.
 *
 * `state_hash` is the value control 8 of `pnpm db:check` re-derives by
 * replaying the journal, so it is taken with `@for/db`'s own `stateHash`, over
 * its own `canonicalJson`. A second notion of "the bytes of a state" is
 * exactly what would make that control report a drift that never happened.
 */
export function writeSnapshot(connection: SqliteConnection, input: SnapshotWriteInput): void {
  const json = canonicalJson(input.state);
  connection
    .prepare(
      `INSERT INTO snapshots
         (id, campaign_id, seq, reducer_version, state_json, state_hash, size_bytes, kind,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign_id, reducer_version, seq) DO NOTHING`,
    )
    .run(
      input.id,
      input.campaignId,
      input.due.seq,
      REDUCER_VERSION,
      json,
      stateHash(input.state),
      Buffer.byteLength(json, 'utf8'),
      input.due.kind,
      input.now,
    );

  if (input.due.kind !== 'rolling') return;
  connection
    .prepare(
      `DELETE FROM snapshots
        WHERE campaign_id = ? AND reducer_version = ? AND kind = 'rolling'
          AND seq NOT IN (
            SELECT seq FROM snapshots
             WHERE campaign_id = ? AND reducer_version = ? AND kind = 'rolling'
             ORDER BY seq DESC LIMIT ?
          )`,
    )
    .run(
      input.campaignId,
      REDUCER_VERSION,
      input.campaignId,
      REDUCER_VERSION,
      ROLLING_SNAPSHOT_KEPT,
    );
}

/** Every snapshot at or after `seq`, gone. The other half of section 3.7, point 1. */
export function dropSnapshotsFrom(
  connection: SqliteConnection,
  campaignId: string,
  seq: number,
): number {
  return connection
    .prepare(`DELETE FROM snapshots WHERE campaign_id = ? AND seq >= ?`)
    .run(campaignId, seq).changes;
}
