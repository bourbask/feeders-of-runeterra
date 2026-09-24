/**
 * Zone D — AI memory and audit (03-donnees.md section 1.5).
 *
 * ADR 0010 decision 6 places `chronicle_jobs` and `ai_turn_renders` here, with
 * the explicit note that `db:rebuild` does NOT touch them: `ai_turn_renders`
 * holds FROZEN renderings of past turns, and section 1.5 forbids recomputing
 * them — any recomputation would change the prompt prefix and miss the cache
 * on the whole rolling window.
 *
 * `ai_calls` is written in the vocabulary of the NARRATOR PORT (02-mj-ia.md
 * section 0.1), never of one provider: `provider` says where it came from,
 * `model` keeps the raw identifier for debugging, and nothing else is specific
 * to an API.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { campaigns } from './campaigns.js';
import { players } from './players.js';

export const chronicles = sqliteTable(
  'chronicles',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 1..N, dense within a campaign. The context reads MAX(version). */
    version: integer('version').notNull(),
    kind: text('kind').notNull().default('incremental'),
    /** Last journal seq covered. */
    sourceEventSeq: integer('source_event_seq').notNull(),
    /** `ChronicleDoc` (02-mj-ia.md section 5). Schema lands with M0-12. */
    docJson: text('doc_json', { mode: 'json' }).$type<unknown>().notNull(),
    /** DETERMINISTIC markdown projection of `doc_json`. */
    renderedMd: text('rendered_md').notNull(),
    /** Measured, hard ceiling 2500. */
    tokenCount: integer('token_count').notNull().default(0),
    /** Raw provider identifier. */
    model: text('model').notNull(),
    /** `chronicle/1.0.0` */
    promptVersion: text('prompt_version').notNull(),
    aiCallId: text('ai_call_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('chronicles_version_uq').on(t.campaignId, t.version),
    index('chronicles_live_idx').on(t.campaignId, sql`${t.version} DESC`),
    check('chronicles_kind_enum', sql`${t.kind} IN ('incremental','rebuild','handwritten')`),
    check('chronicles_doc_json_valid', sql`json_valid(${t.docJson})`),
  ],
);

/**
 * Regeneration lock: ONE job in flight per campaign, with a lease that
 * expires. Without the expiry, a killed worker leaves a campaign with no long
 * memory forever.
 */
export const chronicleJobs = sqliteTable('chronicle_jobs', {
  campaignId: text('campaign_id')
    .primaryKey()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  /** `started_at` + 10 min. */
  leaseExpiresAt: integer('lease_expires_at').notNull(),
  sourceEventSeq: integer('source_event_seq').notNull(),
  attempt: integer('attempt').notNull().default(1),
  workerId: text('worker_id').notNull(),
});

/**
 * Frozen rendering of a past turn, for the rolling prompt window. Never
 * recomputed: a different date format, key order or rounding would change the
 * prefix and miss the prompt cache across the whole window.
 */
export const aiTurnRenders = sqliteTable(
  'ai_turn_renders',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** The `roll.*` that opens the turn. */
    eventSeq: integer('event_seq').notNull(),
    renderedFact: text('rendered_fact').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ name: 'ai_turn_renders_pk', columns: [t.campaignId, t.eventSeq] })],
);

export const championSheets = sqliteTable(
  'champion_sheets',
  {
    id: text('id').primaryKey(),
    /** Canonical slug, e.g. `lissandra`. */
    championId: text('champion_id').notNull(),
    /** Null means the global cache, reachable by every campaign. */
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    schemaVersion: integer('schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    /** `Champion` (section 4.5). Schema lands with M0-09. */
    sheetJson: text('sheet_json', { mode: 'json' }).$type<unknown>().notNull(),
    rawOutputJson: text('raw_output_json', { mode: 'json' }).$type<unknown>(),
    repairsJson: text('repairs_json', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'`),
    /** sha256 of the canonical JSON. */
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull().default('active'),
    forgedByPlayerId: text('forged_by_player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    /** Raw provider identifier. */
    model: text('model').notNull(),
    aiCallId: text('ai_call_id'),
    reviewNotes: text('review_notes'),
    createdAt: integer('created_at').notNull(),
    reviewedAt: integer('reviewed_at'),
  },
  (t) => [
    uniqueIndex('champion_sheets_hash_uq').on(t.championId, t.contentHash),
    index('champion_sheets_lookup_idx').on(t.championId, t.status),
    check('champion_sheets_sheet_json_valid', sql`json_valid(${t.sheetJson})`),
    check(
      'champion_sheets_raw_output_json_valid',
      sql`${t.rawOutputJson} IS NULL OR json_valid(${t.rawOutputJson})`,
    ),
    check('champion_sheets_repairs_json_valid', sql`json_valid(${t.repairsJson})`),
    check(
      'champion_sheets_status_enum',
      sql`${t.status} IN ('draft','active','approved','rejected','superseded')`,
    ),
  ],
);

export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    /** Exactly the port's four uses. An eval run is told apart by `eval_tags_json`. */
    purpose: text('purpose').notNull(),
    /** `NarratorProviderId`. */
    provider: text('provider').notNull(),
    /** RAW identifier returned by the provider. */
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    /** sha256 of the rendered system prompt. */
    systemHash: text('system_hash').notNull(),
    requestJson: text('request_json', { mode: 'json' }).$type<unknown>(),
    responseText: text('response_text'),
    toolCallsJson: text('tool_calls_json', { mode: 'json' }).$type<unknown>(),
    /** `NarrateFinish`, never a provider code. */
    finishReason: text('finish_reason'),
    /** `NarratorErrorCode`. */
    errorCode: text('error_code'),
    /** `structurer()`: 0 means valid JSON first time. */
    repairPasses: integer('repair_passes').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** 0 when the adapter cannot cache. */
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    /** T1..T8 trimming applied to the context. 0 means none. */
    trimLevel: integer('trim_level').notNull().default(0),
    /** sha256 of the assembled context. */
    contextHash: text('context_hash'),
    status: text('status').notNull(),
    errorText: text('error_text'),
    resultingEventSeq: integer('resulting_event_seq'),
    evalTagsJson: text('eval_tags_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('ai_calls_campaign_idx').on(t.campaignId, sql`${t.createdAt} DESC`),
    index('ai_calls_purpose_idx').on(t.purpose, t.status, sql`${t.createdAt} DESC`),
    check('ai_calls_purpose_enum', sql`${t.purpose} IN ('narration','forge','chronicle','judge')`),
    check(
      'ai_calls_provider_enum',
      sql`${t.provider} IN ('stub','anthropic','openai-compatible','ollama')`,
    ),
    check(
      'ai_calls_finish_reason_enum',
      sql`${t.finishReason} IS NULL OR ${t.finishReason} IN ('complete','truncated','tool_call','refused','aborted')`,
    ),
    check(
      'ai_calls_request_json_valid',
      sql`${t.requestJson} IS NULL OR json_valid(${t.requestJson})`,
    ),
    check(
      'ai_calls_tool_calls_json_valid',
      sql`${t.toolCallsJson} IS NULL OR json_valid(${t.toolCallsJson})`,
    ),
    check('ai_calls_trim_level_range', sql`${t.trimLevel} BETWEEN 0 AND 8`),
    check(
      'ai_calls_status_enum',
      sql`${t.status} IN ('ok','refused','invalid_output','error','timeout')`,
    ),
    check('ai_calls_eval_tags_json_valid', sql`json_valid(${t.evalTagsJson})`),
  ],
);
