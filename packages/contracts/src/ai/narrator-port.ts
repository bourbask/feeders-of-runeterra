/**
 * THE STORYTELLER PORT (02-mj-ia.md section 0.1).
 *
 * The server talks to this interface, never to a vendor. A free gateway, an
 * aggregator or a model running on the player's own machine plugs in behind
 * it without the game layer noticing. That is what lets the product run at
 * zero cost, and it is the whole point of P18.
 *
 * THIS FILE IS THE ONLY PLACE IN `packages/contracts/src` ALLOWED TO WRITE A
 * VENDOR NAME, and it writes them in exactly one construct: the
 * `NARRATOR_PROVIDER_IDS` tuple, which IS the port's own vocabulary. The
 * acceptance criterion of M0-12 is a `grep -rlniE` over `src/` that must print
 * this path and nothing else. Two consequences, both deliberate:
 *
 *   - no model identifier, no API parameter name, no proprietary stop code and
 *     no HTTP status ever appears here or anywhere else in the package. What
 *     crosses the port is `NarrateFinish` and `NarratorErrorCode`, two closed
 *     neutral enumerations;
 *   - `providerModel` carries the provider's RAW identifier OUT of an
 *     adapter, for `ai_calls.model` and debugging. It is a string we copy and
 *     never interpret — reading it to branch on a vendor would reopen
 *     everything this file closes.
 *
 * THE TYPES ARE INTERFACES, NOT ZOD SCHEMAS, on purpose. Nothing here crosses
 * a trust boundary: the server builds a `NarrateRequest` and an adapter
 * answers it, both inside the same process. `StructureRequest.schema` is the
 * Zod schema — the request carries the validation instead of being validated.
 */

import type { z } from 'zod';

import type { GameEventType } from '@for/engine';

// ---------------------------------------------------------------- providers

/**
 * The four implementations of the port, in the order the SQL `CHECK` on
 * `ai_calls.provider` writes them (03-donnees.md section 1.5).
 *
 * ORDER IS PART OF THE CONTRACT, and a test compares this tuple to the `CHECK`
 * clause read from `packages/db/schema.expected.sql`, member by member. Two
 * lists of four strings in two languages is exactly the shape ADR 0007 says a
 * `satisfies` cannot guard: nothing but a runtime comparison catches a fifth
 * provider added on one side only.
 *
 * `stub` is NOT a vendor. It is an implementation of the port that renders the
 * engine's fallback templates with no socket open, which is what lets the CI
 * and the simulator run without a key (section 0.6).
 */
export const NARRATOR_PROVIDER_IDS = ['stub', 'anthropic', 'openai-compatible', 'ollama'] as const;

export type NarratorProviderId = (typeof NARRATOR_PROVIDER_IDS)[number];

// ------------------------------------------------------------- input blocks

/**
 * A neutral JSON Schema object, the only form in which a tool's input shape
 * crosses the port. Translating it into whatever a provider expects is the
 * adapter's job.
 *
 * `additionalProperties: false` and a COMPLETE `required` are not advice:
 * `tests/ai/tools.test.ts` converts every tool input schema and walks the tree
 * for both. The shape stays loose (`unknown` leaves) because the JSON Schema a
 * provider accepts is an impoverished subset of ours — no length bounds, no
 * value bounds, no recursion (section 9.4) — and pretending otherwise here
 * would invite somebody to rely on a keyword half the adapters drop.
 */
export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly [key: string]: unknown;
}

/**
 * Reuse HINT, never an order. An adapter that cannot cache ignores it, and
 * that changes NOTHING in what is sent — only the bill.
 */
export type NarratorCacheHint = 'stable' | 'session' | 'rolling';

export interface NarratorTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cacheHint?: NarratorCacheHint;
}

export interface NarratorToolUseBlock {
  readonly type: 'tool_use';
  readonly callId: string;
  readonly tool: string;
  /** Already parsed; never a JSON string. Revalidated by us, always. */
  readonly input: unknown;
}

export interface NarratorToolResultBlock {
  readonly type: 'tool_result';
  readonly callId: string;
  /** Compact JSON, keys sorted — a stable body is a cacheable body. */
  readonly content: string;
  readonly isError: boolean;
}

export type NarratorBlock = NarratorTextBlock | NarratorToolUseBlock | NarratorToolResultBlock;

export interface NarratorMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly NarratorBlock[];
}

export interface NarratorToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
}

/** Depth of processing asked for. NOT a provider parameter. */
export type NarratorEffort = 'low' | 'medium' | 'high';

export type NarratorToolPolicy = 'auto' | 'none';

export interface NarrateRequest {
  readonly purpose: 'narration';
  /** = `narrationId`; the key of the `ai_calls` row. */
  readonly requestId: string;
  readonly system: readonly NarratorTextBlock[];
  readonly messages: readonly NarratorMessage[];
  /** The frozen, ordered table of section 3.4. A varying table kills the cache. */
  readonly tools: readonly NarratorToolSpec[];
  readonly toolPolicy: NarratorToolPolicy;
  readonly maxOutputTokens: number;
  readonly effort: NarratorEffort;
  readonly abortSignal?: AbortSignal;
}

/**
 * The four `structurer()` purposes, in the order the SQL `CHECK` on
 * `ai_calls.purpose` writes them, minus `narration` which belongs to
 * `narrer()`. Compared against that `CHECK` at runtime, like the providers.
 */
export const NARRATOR_PURPOSES = ['narration', 'forge', 'chronicle', 'judge'] as const;
export type NarratorPurpose = (typeof NARRATOR_PURPOSES)[number];
export type NarratorStructuredPurpose = Exclude<NarratorPurpose, 'narration'>;

export interface StructureRequest<T> {
  readonly purpose: NarratorStructuredPurpose;
  readonly requestId: string;
  readonly system: readonly NarratorTextBlock[];
  readonly messages: readonly NarratorMessage[];
  /** THE source of truth of the expected shape. */
  readonly schema: z.ZodType<T>;
  /** Short readable name, for providers that want one. */
  readonly schemaName: string;
  readonly maxOutputTokens: number;
  readonly effort: NarratorEffort;
  readonly abortSignal?: AbortSignal;
}

// ------------------------------------------------------------ output blocks

export interface NarratorUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 0 when the adapter cannot cache, or cannot measure. */
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/**
 * How a call ended, in the port's words. `ai_calls.finish_reason` carries
 * these five and nothing else — never a provider's own code.
 */
export const NARRATE_FINISHES = [
  'complete',
  'truncated',
  'tool_call',
  'refused',
  'aborted',
] as const;

export type NarrateFinish = (typeof NARRATE_FINISHES)[number];

export interface NarrateResult {
  /** Accumulated prose, tool calls excluded. */
  readonly text: string;
  readonly finish: NarrateFinish;
  /** Empty unless `finish === 'tool_call'`. */
  readonly toolCalls: readonly NarratorToolUseBlock[];
  readonly usage: NarratorUsage;
  /** RAW provider identifier, copied into `ai_calls.model`. Never branched on. */
  readonly providerModel: string;
  readonly latencyMs: number;
}

export interface StructureResult<T> {
  /** ALREADY validated against `schema`: the signature is the guarantee. */
  readonly value: T;
  readonly usage: NarratorUsage;
  readonly providerModel: string;
  readonly latencyMs: number;
  /** 0 = valid JSON on the first try (section 0.2). */
  readonly repairPasses: number;
}

/**
 * The stream `narrer()` returns. Pulled by the reader (`for await`), which is
 * where the backpressure comes from: a broadcast that does not swallow fast
 * enough stops the adapter reading its upstream socket.
 *
 * Exactly one `end`, always last. `result.text` is the ordered concatenation
 * of every `delta`: never two truths about the text.
 */
export type NarrateEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: NarratorToolUseBlock }
  | { readonly type: 'end'; readonly result: NarrateResult };

// ------------------------------------------------------------- capabilities

export interface NarratorCapabilities {
  /** False ⇒ the port emits a single `delta` then `end`. */
  readonly streaming: boolean;
  /** False ⇒ `tools` is not transmitted (section 0.2). */
  readonly tools: boolean;
  /** False ⇒ `structurer()` goes through prompt + extraction. */
  readonly structuredOutput: boolean;
  /** False ⇒ `cacheHint` ignored, cache counters stay at 0. */
  readonly promptCache: boolean;
  /** Governs the context budget (section 4.3). */
  readonly contextWindowTokens: number;
  /** 0 when `promptCache` is false. */
  readonly maxCacheBreakpoints: number;
}

export interface NarratorPort {
  readonly providerId: NarratorProviderId;
  readonly capabilities: NarratorCapabilities;
  /**
   * SINGLE SHOT. It stops on `finish: 'tool_call'`; the tool loop lives ABOVE
   * the port, in `@for/ai`, bounded to three iterations. An adapter that
   * looped on its own would make server validation of proposals unreachable,
   * which is invariant 1 lost inside a vendor SDK.
   */
  narrer(req: NarrateRequest): AsyncIterable<NarrateEvent>;
  structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>>;
}

// -------------------------------------------------------------- the errors

/**
 * The neutral error enumeration. The retry policy of section 7.1 is written
 * against THIS list, so there is one policy to test rather than one per
 * vendor.
 */
export const NARRATOR_ERROR_CODES = [
  'unauthenticated',
  'unauthorized',
  'rate_limited',
  'quota_exhausted',
  'unavailable',
  'timeout',
  'bad_request',
  'context_too_large',
  'model_not_found',
  'refused',
  'invalid_output',
  'unsupported',
  'aborted',
  'internal',
] as const;

export type NarratorErrorCode = (typeof NARRATOR_ERROR_CODES)[number];

/**
 * The three codes section 7.1 says to retry WITH THE SAME REQUEST.
 *
 * `context_too_large` is deliberately absent. Section 7.1 re-emits it once,
 * but with the truncation scale one notch lower — a DIFFERENT request. Calling
 * that a retry would let a caller resend the identical oversized body and
 * collect the identical error, and would blur the one line of section 7.2 that
 * matters: never retry what cannot succeed.
 */
export const NARRATOR_RETRYABLE_ERROR_CODES = ['rate_limited', 'unavailable', 'timeout'] as const;

export type NarratorRetryableErrorCode = (typeof NARRATOR_RETRYABLE_ERROR_CODES)[number];

const RETRYABLE = new Set<string>(NARRATOR_RETRYABLE_ERROR_CODES);

/** Whether section 7.1 allows resending the identical request. */
export function isRetryableNarratorErrorCode(code: NarratorErrorCode): boolean {
  return RETRYABLE.has(code);
}

export interface NarratorErrorInit {
  readonly code: NarratorErrorCode;
  readonly providerId: NarratorProviderId;
  /** Developer-facing wording. Defaults to the code itself. */
  readonly message?: string;
  /** Milliseconds the provider asked us to wait, when it says so. */
  readonly retryAfterMs?: number | null;
  /** Raw provider detail. NEVER shown to a player, redacted before logging. */
  readonly providerDetail?: string | null;
  readonly cause?: unknown;
}

/**
 * The ONLY error type allowed out of an adapter. No SDK exception, no `fetch`
 * rejection and no parser throw crosses the port (section 0.1, contract 3).
 *
 * `retryable` IS COMPUTED FROM `code`, and there is no way to set it.
 * Accepting it as a parameter would let an adapter declare a
 * `quota_exhausted` retryable, and section 7.2 says in so many words that we
 * never retry one. A field the caller fills is a field the caller can get
 * wrong; a field derived from a closed list cannot lie.
 */
export class NarratorError extends Error {
  readonly code: NarratorErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly providerId: NarratorProviderId;
  readonly providerDetail: string | null;

  constructor(init: NarratorErrorInit) {
    super(init.message ?? init.code, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'NarratorError';
    this.code = init.code;
    this.retryable = isRetryableNarratorErrorCode(init.code);
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.providerId = init.providerId;
    this.providerDetail = init.providerDetail ?? null;
  }
}

// ------------------------------------------------------------ configuration

/** Section 0.6. `probe` sends one capability probe at start-up, once. */
export const NARRATOR_TOOLS_MODES = ['on', 'off', 'probe'] as const;
export type NarratorToolsMode = (typeof NARRATOR_TOOLS_MODES)[number];

/**
 * What `selectNarrator()` receives (section 0.6). Built once, at start-up, by
 * `packages/server/src/env.ts` — the ONLY place in the system that reads the
 * environment. `@for/ai` never touches `process.env`, which is what makes the
 * eval harness runnable outside the server.
 *
 * Every field is present and nullable rather than optional: `buildNarrator`
 * reads all eight unconditionally, and an `undefined` there would be a silent
 * configuration bug (section 0.6, the three auxiliary variables).
 */
export interface NarratorConfig {
  readonly provider: NarratorProviderId;
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly model: string | null;
  readonly modelStructured: string | null;
  readonly tools: NarratorToolsMode;
  readonly timeoutMs: number;
  /** Null ⇒ the adapter's own default window. */
  readonly contextWindowTokens: number | null;
}

// --------------------------------------------- what the model can ever write

/**
 * THE THREE CLOSED LISTS OF INVARIANT 1 (03-donnees.md section 0.5).
 *
 * There are exactly three circuits by which the model reaches the STATE
 * journal, and each one has its list here, typed `readonly GameEventType[]` so
 * a misspelt event type does not compile.
 *
 * They live in `@for/contracts` rather than in the server because three
 * separate packages read them — `@for/ai` when it validates a proposal,
 * `@for/server` in `proposal-surface.test.ts`, and the eval harness — and
 * three copies of a closed list is how a closed list stops being closed.
 *
 * NOT ONE `character.*` AND NOT ONE `roll.*` IN CIRCUIT 1. That is the whole
 * guarantee, and `tests/ai/tools.test.ts` asserts it rather than trusting the
 * reader to check. P11 is the cautionary tale: `time_shift` made
 * `character.gauge_changed` reachable from a proposal, and the tempting fix on
 * the day would have been to widen this list. A closed list widened once is
 * not closed.
 */
export const PROPOSAL_REACHABLE_EVENT_TYPES = [
  'entity.introduced',
  'entity.updated',
  'entity.status_changed',
  'clock.created',
  'clock.advanced',
  'scene.started',
  'scene.ended',
  'scene.facts_updated',
] as const satisfies readonly GameEventType[];

/** Circuit 2: `roll_oracle`, the one read tool that writes. */
export const ORACLE_JOURNAL_ONLY_EVENT_TYPES = [
  'roll.oracle_resolved',
  'roll.yes_no_resolved',
] as const satisfies readonly GameEventType[];

/** Circuit 3: the storyteller's proven right of refusal (section 4.8). */
export const REFUSAL_REACHABLE_EVENT_TYPES = [
  'system.reverted',
] as const satisfies readonly GameEventType[];
