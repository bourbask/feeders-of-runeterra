/**
 * The raw SQLite row shapes and the mapping to camel case.
 *
 * WHY HAND-WRITTEN SQL RATHER THAN THE DRIZZLE QUERY BUILDER, everywhere in
 * `repositories/`. The journal needs four things the builder does not express:
 * `BEGIN IMMEDIATE`, `UPDATE … RETURNING`, `json_each` over
 * `recipients_json`, and a `ROW_NUMBER()` window. Writing half the layer in
 * one style and half in another would hide where the interesting SQL lives, so
 * the whole layer is one style. Drizzle stays what it already was here: the
 * declaration the migrations are generated from.
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

/** A row of `events`, read back. Mirrors `EventEnvelopeDto` field for field. */
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
