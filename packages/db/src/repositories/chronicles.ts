/**
 * Zone D — the compacted chronicle (03-donnees.md section 1.5).
 *
 * Invariant 2: the long memory lives here, not in the context window. The
 * context reads `MAX(version)`, which is what `latestChronicle` returns.
 *
 * `version` is dense per campaign and carries a unique index, so a concurrent
 * second writer fails on the index rather than silently forking the memory.
 * `nextVersion` therefore reads and writes under the caller's transaction, and
 * `insertChronicle` does its own allocation for the same reason the journal
 * does: a read-then-write split across two statements is a race.
 */

import type { SqliteConnection } from '../client.js';

export interface ChronicleInsert {
  readonly id: string;
  readonly campaignId: string;
  /** Last journal `seq` this chronicle covers. */
  readonly sourceEventSeq: number;
  readonly doc: unknown;
  /** Deterministic markdown projection of `doc`. */
  readonly renderedMd: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: number;
  readonly kind?: 'incremental' | 'rebuild' | 'handwritten';
  readonly tokenCount?: number;
  readonly aiCallId?: string | null;
}

export interface ChronicleRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly version: number;
  readonly kind: string;
  readonly source_event_seq: number;
  readonly doc_json: string;
  readonly rendered_md: string;
  readonly token_count: number;
  readonly model: string;
  readonly prompt_version: string;
  readonly ai_call_id: string | null;
  readonly created_at: number;
}

/** Inserts the next version and returns it. Allocation and insert are atomic. */
export function insertChronicle(connection: SqliteConnection, row: ChronicleInsert): number {
  const write = connection.transaction((): number => {
    const current = connection
      .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM chronicles WHERE campaign_id = ?`)
      .get(row.campaignId) as { v: number };
    const version = current.v + 1;
    connection
      .prepare(
        `INSERT INTO chronicles
           (id, campaign_id, version, kind, source_event_seq, doc_json, rendered_md,
            token_count, model, prompt_version, ai_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.campaignId,
        version,
        row.kind ?? 'incremental',
        row.sourceEventSeq,
        JSON.stringify(row.doc),
        row.renderedMd,
        row.tokenCount ?? 0,
        row.model,
        row.promptVersion,
        row.aiCallId ?? null,
        row.createdAt,
      );
    return version;
  });
  return write.immediate();
}

/** The live long memory: the highest version of that campaign. */
export function latestChronicle(
  connection: SqliteConnection,
  campaignId: string,
): ChronicleRow | undefined {
  return connection
    .prepare(`SELECT * FROM chronicles WHERE campaign_id = ? ORDER BY version DESC LIMIT 1`)
    .get(campaignId) as ChronicleRow | undefined;
}
