/**
 * Invariant 4, in the two halves ADR 0008 split it into.
 *
 * ── HALF ONE : THE TABLE ─────────────────────────────────────────────────
 * §7.4: "rejoue tout le journal depuis l'etat initial, egalite stricte exigee
 * avec le snapshot". TWO ROADS, and that is the whole value of the
 * comparison: the snapshot comes out of `CampaignService.getSnapshot`, which
 * goes through the SNAPSHOT CACHE (`loadState` picks the best row of
 * `snapshots` and replays only what follows it), while the replay below
 * starts at `seq 0` with an empty state. A stale snapshot, a snapshot written
 * at the wrong `seq`, a reducer that is not a pure function of the journal:
 * each of those makes the two disagree. Comparing `loadReplay` to
 * `reduceAll` would have been one road walked twice.
 *
 * ── HALF TWO : THE PLAYER (ADR 0008, and it is the half that gets lost) ──
 * "Rejouer le journal du point de vue d'un joueur doit redonner exactement ce
 * qu'il a vu, NI PLUS NI MOINS." A global check leaves that entirely
 * unmeasured — it was already true before scopes existed. So this one is per
 * player, and it compares:
 *
 *   - THE BYTES the player's transport received, `s2c.event` by `s2c.event`
 *     and `s2c.events_batch` entry by entry, deduplicated on `deliverySeq`;
 *   - against `readSinceForPlayer`, which is `@for/db`'s SQL expression of the
 *     visibility predicate.
 *
 * Two expressions of one rule, and `packages/server/src/ws/hub.ts` says in so
 * many words that NOTHING in that package compares them. This does: the third
 * assertion below runs the hub's own `isVisibleTo` over every delivered entry
 * and requires it to agree with the SQL, so a `scope` the TypeScript predicate
 * and the SQL fragment read differently is a red scenario rather than a
 * disclosure.
 *
 * ── WHAT A SNAPSHOT DOES TO « NI PLUS NI MOINS » ────────────────────────
 * A player who joins an existing table is sent an `s2c.snapshot`, not a
 * replay of the whole campaign — that is what `c2s.hello` with a null cursor
 * means (§5.4). So the entries BEFORE that snapshot's cursor were never
 * written to their transport, and demanding them would be demanding a bug.
 * The comparison therefore starts at the HIGHEST snapshot cursor the player
 * received, and everything after it must match their replayed thread entry
 * for entry. A check that ignored the snapshot would have failed every
 * scenario; one that ignored the cursor and compared only what arrived would
 * have passed a server that stopped streaming halfway.
 *
 * ── WHAT A DUPLICATE MEANS, AND WHY IT IS NOT A FAILURE ──────────────────
 * A reconnection legitimately re-delivers: `handleResume` sends a snapshot and
 * then flushes the window behind it, which costs one duplicate frame by
 * design (`handlers.ts`, `flushAfterSnapshot`). So a `deliverySeq` seen twice
 * is accepted WHEN BOTH FRAMES CARRY THE SAME ENTRY, and refused otherwise —
 * two different entries under one delivery number is the bug that number
 * exists to prevent.
 */

import { canonicalJson } from '@for/db';
import { createInitialCampaignState, reduceAll } from '@for/engine';
import { isVisibleTo, toTableState } from '@for/server';

import type { JournalEvent } from '@for/db';
import type { CampaignId, GameEvent, PlayerId } from '@for/engine';
import type { CapturedFrame, PlayerTape } from '../harness.js';

/** One thing the replay disagreed about. */
export interface ReplayMismatch {
  /** The player the mismatch is about, or `null` for the table as a whole. */
  readonly playerSymbol: string | null;
  readonly issue: string;
}

interface Delivered {
  readonly deliverySeq: number;
  readonly seq: number;
  readonly id: string;
  readonly scope: string;
  readonly recipients: readonly string[] | null;
}

interface FrameEvent {
  readonly id?: unknown;
  readonly seq?: unknown;
  readonly scope?: unknown;
  readonly recipients?: unknown;
}

function entriesOf(frame: CapturedFrame): readonly Delivered[] {
  const read = (event: unknown, deliverySeq: unknown, seq: unknown): Delivered | null => {
    if (typeof event !== 'object' || event === null) return null;
    const row = event as FrameEvent;
    if (typeof deliverySeq !== 'number' || typeof row.id !== 'string') return null;
    return {
      deliverySeq,
      seq: typeof seq === 'number' ? seq : Number(row.seq),
      id: row.id,
      scope: typeof row.scope === 'string' ? row.scope : 'table',
      recipients: Array.isArray(row.recipients) ? (row.recipients as readonly string[]) : null,
    };
  };

  if (frame.type === 's2c.event') {
    const one = read(frame.payload['event'], frame.deliverySeq, frame.seq);
    return one === null ? [] : [one];
  }
  if (frame.type === 's2c.events_batch') {
    const list = (frame.payload['events'] ?? []) as {
      event?: unknown;
      deliverySeq?: unknown;
      seq?: unknown;
    }[];
    return list
      .map((entry) => read(entry.event, entry.deliverySeq, entry.seq))
      .filter((entry): entry is Delivered => entry !== null);
  }
  return [];
}

/**
 * What this player's transport actually received, in delivery order.
 *
 * @throws never — a contradiction is reported as a mismatch, not raised, so
 * the report can name every player rather than the first broken one.
 */
export function deliveredTo(tape: PlayerTape): {
  readonly entries: readonly Delivered[];
  readonly issues: readonly string[];
} {
  const byDelivery = new Map<number, Delivered>();
  const issues: string[] = [];
  for (const frame of tape.frames) {
    for (const entry of entriesOf(frame)) {
      const seen = byDelivery.get(entry.deliverySeq);
      if (seen === undefined) {
        byDelivery.set(entry.deliverySeq, entry);
        continue;
      }
      if (seen.id !== entry.id) {
        issues.push(
          `livraison ${String(entry.deliverySeq)} porte deux entrées différentes : ` +
            `${seen.id} puis ${entry.id}`,
        );
      }
    }
  }
  const entries = [...byDelivery.values()].sort((a, b) => a.deliverySeq - b.deliverySeq);
  return { entries, issues };
}

/**
 * The highest cursor a snapshot handed this player.
 *
 * `s2c.snapshot` carries the DELIVERY number (ADR 0010), and everything at or
 * below it was replaced by the state the snapshot carries rather than
 * streamed. `s2c.welcome` is deliberately NOT read here: it announces a
 * cursor and is followed by EITHER a snapshot or a catch-up batch, and only
 * the snapshot replaces what came before.
 */
export function snapshotCursorOf(tape: PlayerTape): number {
  let base = 0;
  for (const frame of tape.frames) {
    if (frame.type !== 's2c.snapshot') continue;
    const value = frame.payload['lastDeliverySeq'];
    if (typeof value === 'number') base = Math.max(base, value);
  }
  return base;
}

export interface ReplayInput {
  readonly campaignId: CampaignId;
  readonly ownerPlayerId: PlayerId;
  readonly seed: string;
  readonly journal: readonly GameEvent[];
  /** What `CampaignService.getSnapshot` served, for the viewer named below. */
  readonly snapshot: unknown;
  readonly tapes: ReadonlyMap<string, PlayerTape>;
  readonly threadOf: (playerId: PlayerId) => readonly JournalEvent[];
}

export function checkReplayEquivalence(input: ReplayInput): readonly ReplayMismatch[] {
  const mismatches: ReplayMismatch[] = [];

  // ---- half one : the table -------------------------------------------
  const replayed = toTableState(
    reduceAll(
      createInitialCampaignState({
        campaignId: input.campaignId,
        ownerPlayerId: input.ownerPlayerId,
        seed: input.seed,
      }),
      input.journal,
    ),
  );
  if (canonicalJson(replayed) !== canonicalJson(input.snapshot)) {
    mismatches.push({
      playerSymbol: null,
      issue:
        'le rejeu intégral du journal ne rend pas l’instantané servi par le service ' +
        '(invariant 4, moitié « table »)',
    });
  }

  // ---- half two : the player ------------------------------------------
  for (const [symbol, tape] of input.tapes) {
    const { entries, issues } = deliveredTo(tape);
    for (const issue of issues) mismatches.push({ playerSymbol: symbol, issue });

    const thread = input.threadOf(tape.playerId);
    const base = snapshotCursorOf(tape);
    const byDelivery = new Map(entries.map((entry) => [entry.deliverySeq, entry]));

    // « NI PLUS » — everything the transport received is an entry of THIS
    // player's thread, at the rank the thread gives it. A frame carrying
    // somebody else's entry, or the right entry under the wrong number, both
    // land here.
    for (const entry of entries) {
      const expected = thread[entry.deliverySeq - 1];
      if (expected === undefined) {
        mismatches.push({
          playerSymbol: symbol,
          issue:
            `livraison ${String(entry.deliverySeq)} au-delà de son fil, qui compte ` +
            `${String(thread.length)} entrées`,
        });
        continue;
      }
      if (expected.id !== entry.id) {
        mismatches.push({
          playerSymbol: symbol,
          issue:
            `livraison ${String(entry.deliverySeq)} porte ${entry.id}, son fil rejoué dit ` +
            `${expected.id} (${expected.type})`,
        });
      }
    }

    // « NI MOINS » — everything past the last snapshot's cursor reached the
    // transport. Below that cursor a snapshot replaced the state wholesale
    // (§5.4), so those entries were never owed as frames.
    for (const [at, expected] of thread.entries()) {
      if (at < base) continue;
      if (byDelivery.has(at + 1)) continue;
      mismatches.push({
        playerSymbol: symbol,
        issue:
          `entrée ${String(expected.seq)} (${expected.type}) jamais livrée — elle est dans son ` +
          `fil au rang ${String(at + 1)}, au-delà de l'instantané au curseur ${String(base)}`,
      });
    }

    // The third assertion: the hub's TypeScript predicate against the SQL one.
    for (const entry of entries) {
      const visible = isVisibleTo(
        {
          scope: entry.scope,
          recipients: entry.recipients,
        } as unknown as Parameters<typeof isVisibleTo>[0],
        tape.playerId,
      );
      if (!visible) {
        mismatches.push({
          playerSymbol: symbol,
          issue: `entrée ${entry.id} livrée alors que la portée « ${entry.scope} » ne la lui ouvre pas`,
        });
      }
    }
  }

  return mismatches;
}
