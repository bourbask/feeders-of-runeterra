/**
 * The raw SQLite row shapes and the mapping to camel case.
 *
 * WHY HAND-WRITTEN SQL RATHER THAN THE DRIZZLE QUERY BUILDER, everywhere in
 * `repositories/`. TWO things the journal needs are genuinely outside the
 * builder at the pinned version: `json_each` over `recipients_json`, and a
 * `ROW_NUMBER()` window. The DECIDING reason for the rest of the layer is
 * style, not capability: writing half of it in one style and half in another
 * would hide where the interesting SQL lives.
 *
 * An earlier version of this header also claimed `BEGIN IMMEDIATE` and
 * `UPDATE … RETURNING` were beyond the builder. BOTH CLAIMS WERE FALSE for
 * drizzle-orm 0.45.3, the version this package pins:
 * `SQLiteTransactionConfig.behavior` accepts `'immediate'`
 * (sqlite-core/session.d.ts:51) and `.returning()` exists on the UPDATE
 * builder (sqlite-core/query-builders/update.d.ts). The decision stands on the
 * style argument alone; the technical argument is withdrawn.
 *
 * Drizzle stays what it already was here: the declaration the migrations are
 * generated from.
 *
 * `payload_json` and `recipients_json` come back as TEXT through this path,
 * not as parsed objects: the `{ mode: 'json' }` of the Drizzle declaration is
 * a builder feature, and these functions do the parsing themselves.
 */

import type { ActorKind, EventScope } from '@for/engine';

/** A row of `events`, exactly as SQLite hands it over. */
export interface EventRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly seq: number;
  readonly play_session_id: string | null;
  readonly type: string;
  readonly payload_version: number;
  readonly payload_json: string;
  readonly actor_kind: string;
  readonly actor_player_id: string | null;
  readonly subject_character_id: string | null;
  readonly correlation_id: string | null;
  readonly causation_id: string | null;
  readonly rng_stream: string | null;
  readonly rng_draw_index: number | null;
  readonly scope: string;
  readonly recipients_json: string | null;
  readonly created_at: number;
}

/**
 * A row of `events`, read back.
 *
 * MIRRORS `EventEnvelopeDto` (@for/contracts) FIELD FOR FIELD, plus `type` and
 * `payload`, which the envelope leaves to each of the 71 variants. Per ADR
 * 0007 a mirror is guaranteed by an EXECUTION test, never by this sentence:
 * `tests/journal-mirror.test.ts` writes one event with every envelope field
 * populated, reads it back through the only read path, compares the key sets
 * against `eventEnvelopeShape` and parses the result with `zEventEnvelope`. A
 * field added to the canonical envelope turns that test red here.
 */
export interface JournalEvent {
  readonly id: string;
  readonly campaignId: string;
  readonly seq: number;
  readonly playSessionId: string | null;
  readonly type: string;
  readonly payloadVersion: number;
  readonly payload: unknown;
  readonly actorKind: ActorKind;
  readonly actorPlayerId: string | null;
  readonly subjectCharacterId: string | null;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly rngStream: string | null;
  readonly rngDrawIndex: number | null;
  readonly scope: EventScope;
  readonly recipients: readonly string[] | null;
  readonly createdAt: number;
}

/**
 * One event as the reader sees it, plus its rank in THAT reader's stream.
 *
 * ADR 0010: `deliverySeq` is dense per (campaign, player) and lives in the
 * protocol, NOT in the journal. It is therefore COMPUTED at read time by a
 * window over the filtered stream — there is no `delivery_seq` column, and
 * `tests/events-repo.test.ts` proves the column does not exist.
 */
export interface DeliveredEvent extends JournalEvent {
  /** 1..N, dense, within this player's own stream. */
  readonly deliverySeq: number;
}

/** Turns a raw row into a `JournalEvent`, parsing the two JSON columns. */
export function toJournalEvent(row: EventRow): JournalEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    seq: row.seq,
    playSessionId: row.play_session_id,
    type: row.type,
    payloadVersion: row.payload_version,
    payload: JSON.parse(row.payload_json) as unknown,
    actorKind: row.actor_kind as ActorKind,
    actorPlayerId: row.actor_player_id,
    subjectCharacterId: row.subject_character_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    rngStream: row.rng_stream,
    rngDrawIndex: row.rng_draw_index,
    scope: row.scope as EventScope,
    recipients: row.recipients_json === null ? null : (JSON.parse(row.recipients_json) as string[]),
    createdAt: row.created_at,
  };
}

/** The column list every read of `events` selects, in DDL order. */
export const EVENT_COLUMNS = `id, campaign_id, seq, play_session_id, type, payload_version,
  payload_json, actor_kind, actor_player_id, subject_character_id, correlation_id,
  causation_id, rng_stream, rng_draw_index, scope, recipients_json, created_at`;
