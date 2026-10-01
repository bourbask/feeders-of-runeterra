/**
 * `ai_calls`, the cost counter and the circuit breaker (02-mj-ia.md sections
 * 7.1 and 7.3).
 *
 * ── THE RETRY POLICY IS WRITTEN AGAINST THE PORT, NEVER A PROVIDER ────────
 * Section 7.1 in so many words: "aucun code HTTP, aucune classe d'exception
 * de SDK et aucune chaîne de message de fournisseur n'apparaît dans cette
 * table ni dans le code qui l'implémente". `narratorPlan` below takes a
 * `NarratorErrorCode` and an attempt number, and there is nothing else it
 * could read — classifying a raw error is the adapter's job and the adapter's
 * alone. Held by `tests/ai/calls.test.ts`, « la politique se décide sur le
 * code du port, pas sur un statut HTTP », which walks the whole enumeration.
 *
 * ── A DIVERGENCE, REPORTED RATHER THAN HIDDEN ─────────────────────────────
 * `@for/db` ships `insertAiCall` (M0-15) and it writes FOURTEEN columns: no
 * `finish_reason`, no `cache_read_tokens`, no `cache_write_tokens`. The
 * acceptance criterion of this task asks for the four token counters and for
 * `finish_reason` taken from `NarrateFinish`, so this file writes its own
 * `INSERT`. That is not a second write path for game state — `ai_calls` is
 * zone D, an audit log the reducer never reads (03-donnees.md section 1.5) —
 * but it IS a second statement against one table, and it belongs in
 * `@for/db`'s repository the day that package reopens.
 *
 * ── AND A CRITERION THAT IS FALSE BY CONSTRUCTION, SIGNALLED ──────────────
 * The criterion reads: "`error_code` pris dans `NarratorErrorCode` […] un code
 * hors énumération : l'insertion échoue sur la contrainte `CHECK`". There IS
 * no `CHECK` on `ai_calls.error_code` — `schema.expected.sql` declares it as a
 * bare `error_code text`, and only `finish_reason` carries the enumeration
 * constraint. So:
 *
 *   - `finish_reason` is held by SQLite, and `tests/ai/calls.test.ts`
 *     measures it — « un `finish_reason` hors énumération est refusé par la
 *     contrainte CHECK de SQLite »;
 *   - `error_code` is held HERE, by `assertKnownErrorCode`, and measured in
 *     both directions by « un `error_code` hors énumération est refusé avant
 *     l'insertion » and « et les quatorze codes du port passent ».
 *
 * The missing `CHECK` is reported with the pull request; adding it is a
 * migration, which belongs to `@for/db`.
 */

import { NARRATOR_ERROR_CODES, isRetryableNarratorErrorCode } from '@for/contracts';

import type {
  NarrateFinish,
  NarratorErrorCode,
  NarratorProviderId,
  NarratorUsage,
} from '@for/contracts';
import type { SqliteConnection } from '@for/db';

// ------------------------------------------------------------- the audit row

/** Section 7.3: the four counters are persisted per turn, zeros included. */
export const ZERO_USAGE: NarratorUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export type AiCallStatus = 'ok' | 'refused' | 'invalid_output' | 'error' | 'timeout';

export interface AiCallRecord {
  /** `= requestId = narrationId`. One call, one row, one key. */
  readonly id: string;
  readonly campaignId: string | null;
  readonly purpose: 'narration' | 'forge' | 'chronicle' | 'judge';
  readonly provider: NarratorProviderId;
  /** The RAW identifier the adapter handed back. Copied, never interpreted. */
  readonly model: string;
  readonly promptVersion: string;
  readonly systemHash: string;
  readonly status: AiCallStatus;
  readonly usage: NarratorUsage;
  readonly latencyMs: number;
  readonly trimLevel: number;
  readonly createdAt: number;
  /** From `NarrateFinish`. Null for a call that never reached an `end`. */
  readonly finishReason?: NarrateFinish | null;
  /** From `NarratorErrorCode`. Null when the call succeeded. */
  readonly errorCode?: NarratorErrorCode | null;
  readonly resultingEventSeq?: number | null;
  /** Section 2.3 records `scene_block_missing` and friends here. */
  readonly evalTags?: readonly string[];
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(NARRATOR_ERROR_CODES);

/** Raised when a column of `ai_calls` would receive a word from no enumeration. */
export class AiCallVocabularyViolation extends Error {
  readonly column: 'error_code' | 'finish_reason';

  readonly value: string;

  constructor(column: 'error_code' | 'finish_reason', value: string) {
    super(
      `${JSON.stringify(value)} n'appartient pas au vocabulaire du port pour ` +
        `ai_calls.${column} (02-mj-ia.md §0.1).`,
    );
    this.name = 'AiCallVocabularyViolation';
    this.column = column;
    this.value = value;
  }
}

/**
 * The guard the SQL schema does not carry — see the header.
 *
 * There is NO counterpart for `finish_reason`, and its absence is the point:
 * SQLite's own `CHECK` holds that column, and a second guard here would be a
 * rule written twice with nothing comparing the two. A caller that passes a
 * word from no enumeration gets a constraint failure, and
 * `tests/ai/calls.test.ts` measures exactly that.
 */
export function assertKnownErrorCode(code: string | null | undefined): void {
  if (code === null || code === undefined) return;
  if (!KNOWN_ERROR_CODES.has(code)) throw new AiCallVocabularyViolation('error_code', code);
}

/**
 * The port's word for whatever was thrown, or `internal`.
 *
 * It reads `code` off the value WITHOUT importing `NarratorError`, and then
 * checks the word against the enumeration. Two reasons, and the second is the
 * one that matters: an adapter is the only thing allowed to classify a raw
 * failure (section 7.1), so a caller that pattern-matched on the class would
 * be doing the adapter's job; and a `code` that is not one of the fourteen is
 * not a code — `internal` is the honest word for « our side broke in a way no
 * adapter classified », and it is in the enumeration.
 */
export function narratorErrorCodeOf(error: unknown): NarratorErrorCode {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code === 'string' && KNOWN_ERROR_CODES.has(code)
    ? (code as NarratorErrorCode)
    : 'internal';
}

const INSERT_AI_CALL = `INSERT INTO ai_calls
    (id, campaign_id, purpose, provider, model, prompt_version, system_hash,
     finish_reason, error_code, input_tokens, output_tokens, cache_read_tokens,
     cache_write_tokens, latency_ms, trim_level, status, resulting_event_seq,
     eval_tags_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * One row per call to the port. No call leaves without one (section 1.5).
 *
 * `assertKnownErrorCode` runs FIRST so that a word from no enumeration never
 * reaches the column that has no constraint; `finish_reason` then meets
 * SQLite's own `CHECK` whatever this function did.
 */
export function recordAiCall(connection: SqliteConnection, record: AiCallRecord): void {
  assertKnownErrorCode(record.errorCode);
  connection
    .prepare(INSERT_AI_CALL)
    .run(
      record.id,
      record.campaignId,
      record.purpose,
      record.provider,
      record.model,
      record.promptVersion,
      record.systemHash,
      record.finishReason ?? null,
      record.errorCode ?? null,
      record.usage.inputTokens,
      record.usage.outputTokens,
      record.usage.cacheReadTokens,
      record.usage.cacheWriteTokens,
      record.latencyMs,
      record.trimLevel,
      record.status,
      record.resultingEventSeq ?? null,
      JSON.stringify(record.evalTags ?? []),
      record.createdAt,
    );
}

// ------------------------------------------------------------- the cost count

/** Section 7.3: a daily token counter per campaign, read from the base. */
export interface TokenSpend {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** What a budget compares itself to: everything the provider billed. */
  readonly billedTokens: number;
}

/**
 * What this campaign has spent since `sinceMs`.
 *
 * IN THE BASE, not in a counter this process keeps: a restart must not give a
 * campaign a fresh budget. `cacheReadTokens` is counted apart and NOT added to
 * `billedTokens` — a cached read is the thing the cache exists to make cheap,
 * and folding it in would make a working cache look like an overrun.
 */
export function tokenSpendSince(
  connection: SqliteConnection,
  campaignId: string,
  sinceMs: number,
): TokenSpend {
  const row = connection
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0)       AS input_tokens,
              COALESCE(SUM(output_tokens), 0)      AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0)  AS cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
         FROM ai_calls
        WHERE campaign_id = ? AND created_at >= ?`,
    )
    .get(campaignId, sinceMs) as {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    billedTokens: row.input_tokens + row.output_tokens + row.cache_write_tokens,
  };
}

// ------------------------------------------------------------- the retry plan

/**
 * Section 7.1, as three answers and nothing else.
 *
 * `retrim` is `context_too_large` and only that: section 7.1 re-emits it ONCE
 * with the truncation ladder one notch lower, which is a DIFFERENT request.
 * Calling that a retry — as `NARRATOR_RETRYABLE_ERROR_CODES` deliberately does
 * not — would let a caller resend the identical oversized body.
 */
export type NarratorPlan =
  | { readonly kind: 'give_up' }
  | { readonly kind: 'retry'; readonly waitMs: number }
  | { readonly kind: 'retrim' };

/** Section 7.2: never more than twice. Past that a player has waited 8 s. */
export const NARRATOR_ATTEMPTS_MAX = 2;

/** Section 7.1: 500 ms × 2^n, jitter ±20 %, ceiling 4 s. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CEILING_MS = 4000;
export const BACKOFF_JITTER = 0.2;

export interface PlanInput {
  readonly code: NarratorErrorCode;
  /** What the provider asked for, when it said so. */
  readonly retryAfterMs: number | null;
  /** Attempts already made. The first failure arrives with 1. */
  readonly attempt: number;
  /**
   * A number in [0, 1), for the ±20 % jitter. INJECTED: a backoff that reads
   * an ambient generator is a backoff no test can pin, and the whole point of
   * measuring this table is that the wait is a value, not a mood.
   */
  readonly jitter: number;
}

export function backoffMs(attempt: number, jitter: number): number {
  const raw = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CEILING_MS);
  const spread = raw * BACKOFF_JITTER * (jitter * 2 - 1);
  return Math.max(0, Math.round(raw + spread));
}

/**
 * What to do with one failure.
 *
 * `rate_limited` HONOURS `retryAfterMs` when the provider gave one: section
 * 7.1 says "respecter `retryAfterMs` s'il est renseigné ; sinon backoff". A
 * backoff that ignored the header would be the retry the provider asked us
 * not to make, and would earn the rate limit a second time.
 */
export function narratorPlan(input: PlanInput): NarratorPlan {
  if (input.code === 'context_too_large') {
    return input.attempt >= NARRATOR_ATTEMPTS_MAX ? { kind: 'give_up' } : { kind: 'retrim' };
  }
  // `quota_exhausted`, `bad_request`, `unauthenticated`, `refused` and the
  // rest: retrying cannot work, and section 7.2 says so one by one.
  if (!isRetryableNarratorErrorCode(input.code)) return { kind: 'give_up' };
  // `timeout` gets ONE relance (section 7.1), the other two get two.
  const ceiling = input.code === 'timeout' ? 1 : NARRATOR_ATTEMPTS_MAX;
  if (input.attempt >= ceiling) return { kind: 'give_up' };
  return {
    kind: 'retry',
    waitMs: input.retryAfterMs ?? backoffMs(input.attempt, input.jitter),
  };
}

// -------------------------------------------------------- the circuit breaker

/** Section 7.3: five consecutive failures, then sixty seconds offline. */
export const BREAKER_FAILURES_MAX = 5;
export const BREAKER_OPEN_MS = 60_000;

export interface BreakerState {
  readonly openUntil: number;
  readonly consecutiveFailures: number;
}

/**
 * « Conteur hors ligne », per campaign, in this process.
 *
 * IN MEMORY ON PURPOSE, and the reason is an invariant of operation rather
 * than a shortcut: ARCHITECTURE.md section 4.5 declares a single replica and
 * a single writer, so there is exactly one breaker per campaign in the world.
 * Risk 9 of that section already accepts that a redeploy loses the narration
 * in flight; losing a sixty-second breaker with it costs one extra call.
 *
 * WHAT IT NEVER DOES: stop the game. An open breaker means the engine's
 * fallback sentence is used, which is section 0.2's whole rule — on dégrade
 * la prose, jamais l'équité.
 */
export class NarratorBreaker {
  private readonly states = new Map<string, BreakerState>();

  /** True while this campaign is in degraded mode. */
  isOpen(campaignId: string, now: number): boolean {
    const state = this.states.get(campaignId);
    return state !== undefined && state.openUntil > now;
  }

  state(campaignId: string): BreakerState {
    return this.states.get(campaignId) ?? { openUntil: 0, consecutiveFailures: 0 };
  }

  /** A call came back. The streak dies here, and so does any open window. */
  recordSuccess(campaignId: string): void {
    this.states.delete(campaignId);
  }

  /**
   * A call failed. Answers whether the campaign is now offline.
   *
   * `quota_exhausted` ARMS IMMEDIATELY — section 7.1, "coupe-circuit de
   * campagne armé immédiatement", with no retry before it. Waiting for five
   * of those would be five calls that cannot succeed, made on purpose.
   */
  recordFailure(campaignId: string, code: NarratorErrorCode, now: number): boolean {
    const previous = this.state(campaignId);
    const failures = previous.consecutiveFailures + 1;
    const armed = code === 'quota_exhausted' || failures >= BREAKER_FAILURES_MAX;
    this.states.set(campaignId, {
      consecutiveFailures: failures,
      openUntil: armed ? now + BREAKER_OPEN_MS : previous.openUntil,
    });
    return armed;
  }
}
