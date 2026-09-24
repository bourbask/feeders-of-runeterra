/**
 * Zone B — the journal (03-donnees.md section 1.3). APPEND-ONLY.
 *
 * The three triggers that make "append-only" a constraint rather than a habit
 * (`events_no_update`, `events_no_delete`, `events_seq_dense`) are NOT here:
 * drizzle-kit does not model triggers, so they live hand-written at the foot
 * of `migrations/0000_init.sql` and are proven by `tests/append-only.test.ts`.
 *
 * TWO COLUMNS THIS TABLE CARRIES THAT SECTION 1.3 DOES NOT PRINT — ADR 0010
 * decision 5. `scope` and `recipients` were merged into the event envelope on
 * the contracts side (ADR 0008) and were missing from the DDL; an association
 * table was ruled out, at seven players, as complexity without return.
 *
 *   - `scope` TEXT NOT NULL, CHECK on the three values;
 *   - `recipients_json` TEXT, the addressee list for the two narrow scopes.
 *
 * The coherence CHECK between them (`events_recipients_match_scope`) is this
 * task's addition, not the ADR's, and it is reported as such: invariant 4 as
 * ADR 0008 hardened it says replaying the journal FROM ONE PLAYER'S POINT OF
 * VIEW must return exactly what that player saw. A `subset` row with no
 * recipient list cannot answer that question, and a `table` row with one
 * would answer it two different ways. `zEventEnvelope` carries no matching
 * refinement today — a gap for whoever writes the event repository.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { campaigns } from './campaigns.js';
import { players } from './players.js';

/** The three visibility scopes of ADR 0008, mirrored from `zEventScope`. */
export const EVENT_SCOPES = ['table', 'subset', 'private'] as const;

export const events = sqliteTable(
  'events',
  {
    /** ULID. */
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    /** 1..N, dense within a campaign. Allocated through `campaigns.seq`. */
    seq: integer('seq').notNull(),
    /** Logical reference to the running play session. */
    playSessionId: text('play_session_id'),

    /** One of the 71 catalogue types (section 3.4). */
    type: text('type').notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    /** Discriminated union of 71 shapes; typed by `zGameEvent` at both edges. */
    payloadJson: text('payload_json', { mode: 'json' }).$type<unknown>().notNull(),

    // Who caused this event.
    actorKind: text('actor_kind').notNull(),
    actorPlayerId: text('actor_player_id').references(() => players.id, { onDelete: 'set null' }),
    /** Logical reference: the main subject of the event. */
    subjectCharacterId: text('subject_character_id'),

    // Causal traceability. `correlation_id` is the turn group.
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),

    // RNG determinism: every event born of a draw carries its derivation.
    rngStream: text('rng_stream'),
    rngDrawIndex: integer('rng_draw_index'),

    // ADR 0010 decision 5 — who receives this event.
    scope: text('scope').notNull(),
    /** `PlayerId[]`, null on a `table` event. */
    recipientsJson: text('recipients_json', { mode: 'json' }).$type<string[]>(),

    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('events_campaign_seq_uq').on(t.campaignId, t.seq),
    index('events_campaign_type_idx').on(t.campaignId, t.type, t.seq),
    index('events_session_idx').on(t.playSessionId, t.seq),
    index('events_correlation_idx').on(t.correlationId),
    index('events_subject_idx').on(t.campaignId, t.subjectCharacterId, t.seq),
    index('events_created_idx').on(t.createdAt),
    check('events_seq_positive', sql`${t.seq} > 0`),
    check('events_payload_json_valid', sql`json_valid(${t.payloadJson})`),
    check('events_actor_kind_enum', sql`${t.actorKind} IN ('player','engine','gm_ai','system')`),
    check('events_scope_enum', sql`${t.scope} IN ('table','subset','private')`),
    check(
      'events_recipients_json_valid',
      sql`${t.recipientsJson} IS NULL OR json_valid(${t.recipientsJson})`,
    ),
    check(
      'events_recipients_match_scope',
      sql`(${t.scope} = 'table') = (${t.recipientsJson} IS NULL)`,
    ),
  ],
);
