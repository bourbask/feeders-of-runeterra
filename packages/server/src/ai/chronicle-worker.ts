/**
 * The compaction worker: the lease, the debounce, and the periodic rebuild
 * (02-mj-ia.md sections 5.3 and 5.6, 03-donnees.md section 1.5).
 *
 * WHEN to regenerate is `game/chronicle.ts`, a pure function of the journal,
 * delivered by M0-24. WHO regenerates, and the guarantee that only one worker
 * does, is here.
 *
 * ── THE LEASE EXPIRES, AND THAT IS THE WHOLE POINT ───────────────────────
 * `chronicle_jobs` is a lock with a ten-minute bail. A worker killed mid-job
 * would otherwise leave a campaign without long memory FOR EVER — the lock
 * row would sit there with nobody to clear it. So the row carries
 * `lease_expires_at`, and a second worker may take it over once that moment
 * has passed, incrementing `attempt`.
 *
 * Both halves are measured on an injected clock: `tests/ai/chronicle.test.ts`,
 * « un bail expiré est repris par un autre travailleur » and, in the other
 * direction, « et deux travailleurs ne régénèrent jamais la même campagne en
 * même temps » — the second worker is refused while the bail holds, and the
 * refusal is what the assertion reads.
 *
 * ── THE TAKE-OVER IS ONE STATEMENT ───────────────────────────────────────
 * `INSERT … ON CONFLICT … DO UPDATE … WHERE lease_expires_at <= ?` with
 * `RETURNING worker_id`. A read-then-write would be two statements and a
 * race, exactly the one `@for/db` refuses for the journal's own sequence
 * allocation (03-donnees.md section 3.2). The answer is the worker that HOLDS
 * the lease after the statement, which is the only honest answer to "did I
 * get it".
 *
 * ── THE DEBOUNCE IS NOT THE LEASE ────────────────────────────────────────
 * Two different problems, two different guards. The lease stops two workers;
 * the debounce stops ONE worker from compacting twice in a minute because two
 * triggers fired on the same journal. Section 5.3 wants a turn never to wait
 * for a compaction, and a compaction storm is how waiting starts.
 *
 * ── AND A TURN NEVER WAITS FOR THIS ──────────────────────────────────────
 * Nothing in the intent path calls this file. The chronicle is read from the
 * base when a prompt is built and regenerated out of band; a regeneration
 * that failed leaves the previous version in service (section 5.6), because
 * the table is append-only and the old row is still the highest one that
 * validated.
 */

import {
  CHRONICLE_PROMPT_VERSION,
  CHRONICLE_SYSTEM_PROMPT,
  buildChronicleCorrections,
  buildChronicleRequest,
  renderChronicle,
  renderChronicleParts,
  validateChronicle,
} from '@for/ai';
import { insertChronicle, latestChronicle } from '@for/db';

import { narratorErrorCodeOf, recordAiCall } from './calls.js';

import type { ReservedChampion } from '@for/ai';
import type { ChronicleDoc, NarratorPort, SceneStateDto } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { IdFactory } from '@for/engine';

/** 03-donnees.md section 1.5: `started_at + 10 min`. */
export const CHRONICLE_LEASE_MS = 10 * 60_000;

/** One compaction a minute at most, per campaign. Section 5.3. */
export const CHRONICLE_DEBOUNCE_MS = 60_000;

/** Invariant 2: the memory is rebuilt from the journal every eight versions. */
export const CHRONICLE_REBUILD_EVERY = 8;

/** Section 5.6: one retry with `<corrections>`, then the previous version stands. */
export const CHRONICLE_RETRIES_MAX = 1;

export const CHRONICLE_MAX_OUTPUT_TOKENS = 3000;

// ----------------------------------------------------------------- the lease

export interface LeaseInput {
  readonly campaignId: string;
  readonly workerId: string;
  readonly sourceEventSeq: number;
  readonly now: number;
}

export interface Lease {
  readonly workerId: string;
  readonly attempt: number;
  readonly leaseExpiresAt: number;
}

const ACQUIRE = `INSERT INTO chronicle_jobs
    (campaign_id, started_at, lease_expires_at, source_event_seq, attempt, worker_id)
  VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT(campaign_id) DO UPDATE SET
    started_at       = excluded.started_at,
    lease_expires_at = excluded.lease_expires_at,
    source_event_seq = excluded.source_event_seq,
    attempt          = chronicle_jobs.attempt + 1,
    worker_id        = excluded.worker_id
  WHERE chronicle_jobs.lease_expires_at <= ?
  RETURNING worker_id, attempt, lease_expires_at`;

/**
 * Take the campaign's compaction lease, or answer `null`.
 *
 * `null` means somebody else holds it and their bail has not run out. It is
 * not an error and it is not retried: the other worker will finish, or its
 * bail will expire and this one will take over.
 */
export function acquireChronicleLease(
  connection: SqliteConnection,
  input: LeaseInput,
): Lease | null {
  const row = connection
    .prepare(ACQUIRE)
    .get(
      input.campaignId,
      input.now,
      input.now + CHRONICLE_LEASE_MS,
      input.sourceEventSeq,
      input.workerId,
      input.now,
    ) as { worker_id: string; attempt: number; lease_expires_at: number } | undefined;
  if (row?.worker_id !== input.workerId) return null;
  return {
    workerId: row.worker_id,
    attempt: row.attempt,
    leaseExpiresAt: row.lease_expires_at,
  };
}

/** Hands the lease back. A worker that finishes does not wait for its bail. */
export function releaseChronicleLease(
  connection: SqliteConnection,
  campaignId: string,
  workerId: string,
): void {
  connection
    .prepare(
      `UPDATE chronicle_jobs SET lease_expires_at = 0 WHERE campaign_id = ? AND worker_id = ?`,
    )
    .run(campaignId, workerId);
}

/** Who holds it, if anyone. Reading only — the take-over is one statement. */
export function chronicleLeaseHolder(
  connection: SqliteConnection,
  campaignId: string,
): Lease | null {
  const row = connection
    .prepare(
      `SELECT worker_id, attempt, lease_expires_at FROM chronicle_jobs WHERE campaign_id = ?`,
    )
    .get(campaignId) as
    { worker_id: string; attempt: number; lease_expires_at: number } | undefined;
  return row === undefined
    ? null
    : { workerId: row.worker_id, attempt: row.attempt, leaseExpiresAt: row.lease_expires_at };
}

// ------------------------------------------------------------- the two rules

/**
 * Which kind the NEXT version is.
 *
 * Every eighth regeneration is rebuilt from the journal rather than compacted
 * from the version in service — invariant 2's own guard against a summary of
 * a summary. Written against the version about to be INSERTED, so version 8,
 * 16 and 24 are rebuilds and nothing has to remember a counter.
 */
export function chronicleKindFor(nextVersion: number): 'incremental' | 'rebuild' {
  return nextVersion % CHRONICLE_REBUILD_EVERY === 0 ? 'rebuild' : 'incremental';
}

/** True while the previous compaction is too recent to follow. */
export function debounced(lastCreatedAt: number | null, now: number): boolean {
  return lastCreatedAt !== null && now - lastCreatedAt < CHRONICLE_DEBOUNCE_MS;
}

// ---------------------------------------------------------------- the worker

export interface ChronicleWorkerDeps {
  readonly connection: SqliteConnection;
  readonly narrator: NarratorPort;
  readonly ids: IdFactory;
  /** This process's identity in `chronicle_jobs.worker_id`. */
  readonly workerId: string;
}

export interface CompactInput {
  readonly campaignId: string;
  /** The journal material, rendered by the caller. */
  readonly material: string;
  /** Sequences that exist, for C2. */
  readonly knownEventSeqs: ReadonlySet<number>;
  readonly targetEventSeq: number;
  readonly reservedChampions: readonly ReservedChampion[];
  readonly scene: SceneStateDto | null;
  readonly now: number;
}

export type CompactOutcome =
  | { readonly kind: 'skipped'; readonly why: 'leased' | 'debounced' }
  | { readonly kind: 'failed'; readonly why: 'invalid' | 'error'; readonly detail: string }
  | { readonly kind: 'written'; readonly version: number; readonly tokenCount: number };

/**
 * One compaction, from the lease to the row.
 *
 * FAILURE IS NEVER FATAL. A model that cannot produce a valid document leaves
 * the previous version in service — section 5.6 — because the table is
 * append-only and nothing was overwritten. The campaign keeps the memory it
 * had, which is the right degradation: an older memory is a memory.
 */
export async function compactChronicle(
  deps: ChronicleWorkerDeps,
  input: CompactInput,
): Promise<CompactOutcome> {
  const previous = latestChronicle(deps.connection, input.campaignId);

  if (debounced(previous?.created_at ?? null, input.now)) {
    return { kind: 'skipped', why: 'debounced' };
  }

  const lease = acquireChronicleLease(deps.connection, {
    campaignId: input.campaignId,
    workerId: deps.workerId,
    sourceEventSeq: input.targetEventSeq,
    now: input.now,
  });
  if (lease === null) return { kind: 'skipped', why: 'leased' };

  try {
    return await run(deps, input, previous);
  } finally {
    releaseChronicleLease(deps.connection, input.campaignId, deps.workerId);
  }
}

async function run(
  deps: ChronicleWorkerDeps,
  input: CompactInput,
  previous: ReturnType<typeof latestChronicle>,
): Promise<CompactOutcome> {
  const nextVersion = (previous?.version ?? 0) + 1;
  const kind = chronicleKindFor(nextVersion);
  const previousDoc =
    kind === 'rebuild' || previous === undefined
      ? null
      : (JSON.parse(previous.doc_json) as ChronicleDoc);

  let corrections: string | undefined;

  for (let attempt = 0; attempt <= CHRONICLE_RETRIES_MAX; attempt += 1) {
    const requestId = deps.ids.next();
    const request = buildChronicleRequest({
      requestId,
      systemPrompt: CHRONICLE_SYSTEM_PROMPT,
      material: input.material,
      ...(corrections === undefined ? {} : { corrections }),
      maxOutputTokens: CHRONICLE_MAX_OUTPUT_TOKENS,
    });

    let doc: unknown;
    try {
      const answer = await deps.narrator.structurer(request);
      doc = answer.value;
      recordAiCall(deps.connection, {
        id: requestId,
        campaignId: input.campaignId,
        purpose: 'chronicle',
        provider: deps.narrator.providerId,
        model: answer.providerModel,
        promptVersion: CHRONICLE_PROMPT_VERSION,
        systemHash: '',
        status: 'ok',
        usage: answer.usage,
        latencyMs: answer.latencyMs,
        trimLevel: 0,
        finishReason: 'complete',
        createdAt: input.now,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      recordAiCall(deps.connection, {
        id: requestId,
        campaignId: input.campaignId,
        purpose: 'chronicle',
        provider: deps.narrator.providerId,
        model: deps.narrator.providerId,
        promptVersion: CHRONICLE_PROMPT_VERSION,
        systemHash: '',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 0,
        trimLevel: 0,
        errorCode: narratorErrorCodeOf(error),
        createdAt: input.now,
      });
      return { kind: 'failed', why: 'error', detail };
    }

    // `rendered_md` is the FULL deterministic projection, not one rung of the
    // ladder: the row is what a later prompt reads, and the ladder cuts at
    // read time. `renderChronicle` is the same joiner `context/builder.ts`
    // uses, so the bytes stored and the bytes sent agree by construction.
    const rendered = renderChronicle(renderChronicleParts(doc as ChronicleDoc, input.scene));

    const validation = validateChronicle({
      doc,
      previous: previousDoc,
      knownEventSeqs: input.knownEventSeqs,
      targetEventSeq: input.targetEventSeq,
      reservedChampions: input.reservedChampions,
      scene: input.scene,
      rendered,
    });

    if (validation.ok && validation.doc !== null) {
      const version = insertChronicle(deps.connection, {
        id: deps.ids.next(),
        campaignId: input.campaignId,
        sourceEventSeq: input.targetEventSeq,
        doc: validation.doc,
        renderedMd: rendered,
        model: deps.narrator.providerId,
        promptVersion: CHRONICLE_PROMPT_VERSION,
        createdAt: input.now,
        kind,
        tokenCount: validation.tokenCount,
        aiCallId: requestId,
      });
      return { kind: 'written', version, tokenCount: validation.tokenCount };
    }

    corrections = buildChronicleCorrections(validation.violations);
  }

  return {
    kind: 'failed',
    why: 'invalid',
    detail: 'la version précédente reste en service (§5.6)',
  };
}
