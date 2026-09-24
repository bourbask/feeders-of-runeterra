/**
 * Zone D — the trace of every call to the storyteller port (section 1.5).
 *
 * This table is an AUDIT LOG, never an input to the rules. Nothing the engine
 * decides ever reads from it (invariant 1), which is why it carries no foreign
 * key onto `events` in either direction: `resulting_event_seq` is a logical
 * reference, and a call that produced nothing keeps it null.
 *
 * `campaign_id` is nullable and cascades to null: an eval run belongs to no
 * campaign, and an archived campaign must not drag its cost history away.
 */

import type { SqliteConnection } from '../client.js';

export interface AiCallInsert {
  readonly id: string;
  readonly purpose: 'narration' | 'forge' | 'chronicle' | 'judge';
  readonly provider: 'stub' | 'anthropic' | 'openai-compatible' | 'ollama';
  /** Raw identifier as the provider returned it. */
  readonly model: string;
  readonly promptVersion: string;
  readonly systemHash: string;
  readonly status: 'ok' | 'refused' | 'invalid_output' | 'error' | 'timeout';
  readonly createdAt: number;
  readonly campaignId?: string | null;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly trimLevel?: number;
  readonly resultingEventSeq?: number | null;
  readonly errorCode?: string | null;
}

export interface AiCallRow {
  readonly id: string;
  readonly campaign_id: string | null;
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: string;
  readonly system_hash: string;
  readonly status: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
  readonly trim_level: number;
  readonly resulting_event_seq: number | null;
  readonly error_code: string | null;
  readonly created_at: number;
}

export function insertAiCall(connection: SqliteConnection, row: AiCallInsert): void {
  connection
    .prepare(
      `INSERT INTO ai_calls
         (id, campaign_id, purpose, provider, model, prompt_version, system_hash,
          status, input_tokens, output_tokens, latency_ms, trim_level,
          resulting_event_seq, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.campaignId ?? null,
      row.purpose,
      row.provider,
      row.model,
      row.promptVersion,
      row.systemHash,
      row.status,
      row.inputTokens ?? 0,
      row.outputTokens ?? 0,
      row.latencyMs ?? 0,
      row.trimLevel ?? 0,
      row.resultingEventSeq ?? null,
      row.errorCode ?? null,
      row.createdAt,
    );
}

export function getAiCall(connection: SqliteConnection, id: string): AiCallRow | undefined {
  return connection.prepare(`SELECT * FROM ai_calls WHERE id = ?`).get(id) as AiCallRow | undefined;
}

/** Newest first, the way a cost report reads it. */
export function listAiCalls(
  connection: SqliteConnection,
  campaignId: string,
  limit = 100,
): readonly AiCallRow[] {
  return connection
    .prepare(
      `SELECT * FROM ai_calls WHERE campaign_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(campaignId, limit) as AiCallRow[];
}
