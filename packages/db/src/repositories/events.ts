/**
 * The journal: the ONLY write path for game state (03-donnees.md section 2).
 *
 * ── ONE DIVERGENCE FROM SECTION 3.2, AND IT IS NOT A CHOICE ──────────────
 * Section 3.2 prints a batch allocator:
 *
 *     UPDATE campaigns SET seq = seq + :n RETURNING seq;   -- high bound
 *     INSERT INTO events (...) x n                          -- seq-n+1 .. seq
 *
 * That sequence CANNOT run against the schema M0-11 merged. The trigger
 * `events_seq_dense` fires BEFORE INSERT on EVERY row and aborts unless
 * `NEW.seq = campaigns.seq`. After `seq = seq + 3` the counter already holds
 * the high bound, so the first two rows of the batch abort with
 * "events.seq must be allocated via campaigns.seq". Measured, not deduced:
 * a probe ran it and got exactly that error. Section 3.2's own prose says the
 * trigger "checks the last event of the batch" — that is what the trigger was
 * meant to do and not what it does.
 *
 * Two ways out. Widening the trigger to accept a window would make it stop
 * biting on the very thing it exists for: it is the only guard against an
 * event inserted outside the allocator. So this repository allocates ONE seq
 * PER EVENT, inside one `BEGIN IMMEDIATE` transaction. Every property section
 * 3.2 was buying survives — the writer lock is taken once and up front, the
 * batch is atomic, density is enforced row by row instead of once — and the
 * trigger keeps its teeth. The extra cost is n prepared `UPDATE`s under a lock
 * already held.
 *
 * Reported rather than worked around: the printed SQL of section 3.2 is false
 * by construction against the merged DDL. `docs/design/` is not ours to edit;
 * this asks for an ADR.
 *
 * ── ADR 0008: READING BACK ONE PLAYER'S THREAD ───────────────────────────
 * Invariant 4 now reads "replaying the journal FROM ONE PLAYER'S POINT OF VIEW
 * must return exactly what that player saw, no more and no less".
 * `readSinceForPlayer` is that read: a `table` event reaches everyone, a
 * `subset` or `private` event reaches exactly the identifiers in
 * `recipients_json`. The membership test goes through `json_each`, never
 * through `LIKE`: `["p10"]` must not deliver to `p1`, and a test proves it.
 *
 * The same invariant forbids the other end of the range: a `subset` whose
 * recipient list is EMPTY is written by no one, because no replay could ever
 * return it. See `UnaddressableEventError`.
 *
 * ── WHY `BEGIN IMMEDIATE` AND WHAT PROVES IT ─────────────────────────────
 * Both write paths open with `.immediate()`, never the default deferred
 * transaction: the writer lock is taken at `BEGIN`, before the first read, so
 * no allocation is decided on a snapshot another writer has already moved.
 * `tests/immediate-transaction.test.ts` measures BOTH halves of that claim —
 * that `.immediate()` really takes the lock up front on this engine (a
 * deferred read-only transaction gets in while the lock is held, an immediate
 * one does not), and that these two functions really go through it.
 */

import type { SqliteConnection } from '../client.js';
import { campaignSeq } from './campaigns.js';
import type { DeliveredEvent, EventRow, JournalEvent } from './rows.js';
import { EVENT_COLUMNS, toJournalEvent } from './rows.js';

import type { ActorKind, EventScope } from '@for/engine';

/** An event the engine produced, before the journal gives it a `seq`. */
export interface AppendableEvent {
  /** ULID, minted by the caller. */
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly actorKind: ActorKind;
  readonly scope: EventScope;
  /**
   * Required and NON-EMPTY on `subset` and `private`, forbidden on `table`.
   * The DDL CHECK carries the first and third; `UnaddressableEventError`
   * carries "non-empty", which the CHECK does not express.
   */
  readonly recipients?: readonly string[] | null;
  readonly createdAt: number;
  readonly playSessionId?: string | null;
  readonly payloadVersion?: number;
  readonly actorPlayerId?: string | null;
  readonly subjectCharacterId?: string | null;
  readonly correlationId?: string | null;
  readonly causationId?: string | null;
  readonly rngStream?: string | null;
  readonly rngDrawIndex?: number | null;
}

export interface AppendResult {
  /** `null` on an empty batch: nothing was allocated, nothing was written. */
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  readonly events: readonly JournalEvent[];
}

/** Raised when the campaign the batch names does not exist. */
export class UnknownCampaignError extends Error {
  constructor(readonly campaignId: string) {
    super(`campagne inconnue : ${campaignId}`);
    this.name = 'UnknownCampaignError';
  }
}

/**
 * Raised when a `subset` or `private` event names NOBODY.
 *
 * The DDL CHECK `events_recipients_match_scope` only ties `scope = 'table'` to
 * `recipients_json IS NULL`; it says nothing about `[]`. An empty list passes
 * the CHECK and writes a row that `readSinceForPlayer` delivers to no one —
 * a journal entry no replay can ever produce, for anybody. That is a hole in
 * invariant 4 rather than a narrow event, so the only write path refuses it.
 *
 * The canonical type already says so in prose: `EventEnvelope.recipients` is
 * "non-empty only when `scope` is `subset` or `private`". Tightening the CHECK
 * itself would be a migration, which is an ADR, not a repository change.
 */
export class UnaddressableEventError extends Error {
  constructor(
    readonly eventId: string,
    readonly scope: EventScope,
  ) {
    super(`événement ${eventId} de portée ${scope} sans destinataire`);
    this.name = 'UnaddressableEventError';
  }
}

const ALLOCATE_ONE = `UPDATE campaigns SET seq = seq + 1, updated_at = ?
                        WHERE id = ? RETURNING seq`;

const INSERT_EVENT = `INSERT INTO events
  (id, campaign_id, seq, play_session_id, type, payload_version, payload_json,
   actor_kind, actor_player_id, subject_character_id, correlation_id, causation_id,
   rng_stream, rng_draw_index, scope, recipients_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Appends a batch atomically and returns the rows with their allocated `seq`.
 *
 * All or nothing. A failure on the third row of three rolls back the two
 * inserts AND the two increments of `campaigns.seq` — the counter never runs
 * ahead of the journal, so a failed batch leaves no hole. That is the case
 * `tests/events-repo.test.ts` exercises, because a hole is unrecoverable:
 * the journal is append-only and the trigger would refuse to fill it later.
 */
export function appendEvents(
  connection: SqliteConnection,
  input: {
    readonly campaignId: string;
    readonly events: readonly AppendableEvent[];
    readonly now: number;
  },
): AppendResult {
  if (input.events.length === 0) {
    return { firstSeq: null, lastSeq: null, events: [] };
  }

  const write = connection.transaction((): AppendResult => {
    const allocate = connection.prepare(ALLOCATE_ONE);
    const insert = connection.prepare(INSERT_EVENT);
    const written: JournalEvent[] = [];
    let firstSeq = 0;
    let finalSeq = 0;

    for (const event of input.events) {
      if (event.scope !== 'table' && (event.recipients ?? []).length === 0) {
        throw new UnaddressableEventError(event.id, event.scope);
      }
      const allocated = allocate.get(input.now, input.campaignId) as { seq: number } | undefined;
      if (allocated === undefined) {
        throw new UnknownCampaignError(input.campaignId);
      }
      const seq = allocated.seq;
      firstSeq = firstSeq === 0 ? seq : firstSeq;
      finalSeq = seq;
      const recipients = event.recipients ?? null;
      insert.run(
        event.id,
        input.campaignId,
        seq,
        event.playSessionId ?? null,
        event.type,
        event.payloadVersion ?? 1,
        JSON.stringify(event.payload),
        event.actorKind,
        event.actorPlayerId ?? null,
        event.subjectCharacterId ?? null,
        event.correlationId ?? null,
        event.causationId ?? null,
        event.rngStream ?? null,
        event.rngDrawIndex ?? null,
        event.scope,
        recipients === null ? null : JSON.stringify(recipients),
        event.createdAt,
      );
      written.push({
        id: event.id,
        campaignId: input.campaignId,
        seq,
        playSessionId: event.playSessionId ?? null,
        type: event.type,
        payloadVersion: event.payloadVersion ?? 1,
        payload: event.payload,
        actorKind: event.actorKind,
        actorPlayerId: event.actorPlayerId ?? null,
        subjectCharacterId: event.subjectCharacterId ?? null,
        correlationId: event.correlationId ?? null,
        causationId: event.causationId ?? null,
        rngStream: event.rngStream ?? null,
        rngDrawIndex: event.rngDrawIndex ?? null,
        scope: event.scope,
        recipients,
        createdAt: event.createdAt,
      });
    }

    return { firstSeq, lastSeq: finalSeq, events: written };
  });

  // `.immediate` is `BEGIN IMMEDIATE`: the writer lock up front, so no
  // SQLITE_BUSY can land in the middle of an allocation.
  return write.immediate();
}

/** The allocator's value. NOT `MAX(events.seq)` — see `campaignSeq`. */
export function lastSeq(connection: SqliteConnection, campaignId: string): number {
  const seq = campaignSeq(connection, campaignId);
  if (seq === undefined) {
    throw new UnknownCampaignError(campaignId);
  }
  return seq;
}

/** The whole table's thread after `afterSeq`. `0` means from the start. */
export function readSince(
  connection: SqliteConnection,
  campaignId: string,
  afterSeq: number,
  limit = Number.MAX_SAFE_INTEGER,
): readonly JournalEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = ? AND seq > ?
        ORDER BY seq LIMIT ?`,
    )
    .all(campaignId, afterSeq, limit) as EventRow[];
  return rows.map((row) => toJournalEvent(row));
}

/** The events of `firstSeq..lastSeq` inclusive. Used to replay one intent. */
export function readRange(
  connection: SqliteConnection,
  campaignId: string,
  firstSeq: number,
  finalSeq: number,
): readonly JournalEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = ? AND seq BETWEEN ? AND ?
        ORDER BY seq`,
    )
    .all(campaignId, firstSeq, finalSeq) as EventRow[];
  return rows.map((row) => toJournalEvent(row));
}

/**
 * One turn, whole: every entry written under `correlationId`, in order.
 *
 * A turn is a GROUP, not a row — 03-donnees.md section 3.7 cancels a group and
 * section 0.5 builds `TurnProof` from a group — and a burned turn is written by
 * TWO calls to `decide()` under one identifier (section 3.4). Reading the group
 * from the journal is what keeps that true without anyone holding a list: the
 * seed used to keep its own map of correlation to sequences, and a second write
 * under the same identifier silently replaced the first half of the turn.
 */
export function readGroup(
  connection: SqliteConnection,
  campaignId: string,
  correlationId: string,
): readonly JournalEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = ? AND correlation_id = ?
        ORDER BY seq`,
    )
    .all(campaignId, correlationId) as EventRow[];
  return rows.map((row) => toJournalEvent(row));
}

/**
 * The visibility predicate of ADR 0008, as one SQL fragment.
 *
 * `json_each` compares WHOLE array members. A `LIKE '%p1%'` would have
 * delivered a `["p10"]` event to `p1`, which is the quiet version of the bug
 * this whole scope column exists to prevent.
 */
const VISIBLE_TO_PLAYER = `(
  events.scope = 'table'
  OR EXISTS (SELECT 1 FROM json_each(events.recipients_json) AS r WHERE r.value = :playerId)
)`;

/**
 * One player's thread, after `afterSeq` of the GLOBAL sequence.
 *
 * Replaying with `afterSeq = 0` gives back exactly what that player saw, in
 * order — invariant 4 as ADR 0008 hardened it.
 */
export function readSinceForPlayer(
  connection: SqliteConnection,
  campaignId: string,
  playerId: string,
  afterSeq: number,
  limit = Number.MAX_SAFE_INTEGER,
): readonly JournalEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = :campaignId AND seq > :afterSeq AND ${VISIBLE_TO_PLAYER}
        ORDER BY seq LIMIT :limit`,
    )
    .all({ campaignId, playerId, afterSeq, limit }) as EventRow[];
  return rows.map((row) => toJournalEvent(row));
}

/**
 * The same thread, numbered the way the protocol numbers it.
 *
 * ADR 0010: resuming is the PLAYER'S cursor, not the global `seq`. The client
 * sends the last `deliverySeq` it acknowledged; this returns what comes after,
 * each row carrying its own dense rank. The rank is computed by a window over
 * the filtered stream, so nothing about it is stored — `events` has no
 * `delivery_seq` column and must not grow one.
 */
export function readForPlayerAfterDelivery(
  connection: SqliteConnection,
  campaignId: string,
  playerId: string,
  afterDeliverySeq: number,
  limit = Number.MAX_SAFE_INTEGER,
): readonly DeliveredEvent[] {
  const rows = connection
    .prepare(
      `SELECT * FROM (
         SELECT ${EVENT_COLUMNS},
                ROW_NUMBER() OVER (ORDER BY seq) AS delivery_seq
           FROM events
          WHERE campaign_id = :campaignId AND ${VISIBLE_TO_PLAYER}
       )
       WHERE delivery_seq > :afterDeliverySeq
       ORDER BY delivery_seq LIMIT :limit`,
    )
    .all({ campaignId, playerId, afterDeliverySeq, limit }) as (EventRow & {
    delivery_seq: number;
  })[];
  return rows.map((row) => ({ ...toJournalEvent(row), deliverySeq: row.delivery_seq }));
}
