/**
 * Running a tool call: reads are executed, proposals are handed to the server.
 *
 * ── WHAT THIS FILE IS NOT ALLOWED TO DO ─────────────────────────────────────
 * Nothing here touches a gauge, settles an outcome or writes a game event.
 * Reads return data. Proposals are FORWARDED to a sink the server implements,
 * and the sink's answer — `applied`, `adjusted`, `rejected` — is what the
 * model gets back. `@for/ai` knows neither SQLite nor Fastify, which is what
 * makes the eval harness runnable with no database at all.
 *
 * ── A MALFORMED CALL IS DROPPED, NEVER REPAIRED (section 0.2) ───────────────
 * Arguments are revalidated by us against `TOOL_INPUT_SCHEMAS`, whatever the
 * provider promised — half the gateways accept `strict` without enforcing it,
 * and one of them hands tool arguments over as a truncated JSON string. When
 * validation fails we emit NO `tool_result` at all: the caller logs
 * `tool_call_dropped` and re-asks for prose with `toolPolicy: 'none'`.
 * Guessing a plausible value would be deciding in place of the model that
 * decides in place of the engine.
 *
 * ── WHY THE RESULT IS SERIALISED WITH SORTED KEYS ───────────────────────────
 * A `tool_result` block joins the conversation and therefore the cacheable
 * prefix of the NEXT call of the same turn. Two serialisations of the same
 * object would move that prefix for nothing.
 */

import {
  READ_ONLY_TOOL_NAMES,
  TOOL_INPUT_SCHEMAS,
  TOOL_OUTPUT_SCHEMAS,
  type NarratorToolResultBlock,
  type NarratorToolUseBlock,
  type ProposalToolName,
  type ReadOnlyToolName,
  type ToolName,
} from '@for/contracts';
import type { z } from 'zod';

import { TOOL_DEFINITIONS_BY_NAME } from './definitions.js';

/** Reasons a call never becomes a `tool_result`. All of them are OUR bugs or the model's. */
export const TOOL_DROP_REASONS = ['unknown_tool', 'invalid_arguments'] as const;
export type ToolDropReason = (typeof TOOL_DROP_REASONS)[number];

export type ToolCallOutcome =
  | { readonly kind: 'result'; readonly block: NarratorToolResultBlock }
  | { readonly kind: 'dropped'; readonly tool: string; readonly reason: ToolDropReason };

type ReadInput<N extends ReadOnlyToolName> = z.output<(typeof TOOL_INPUT_SCHEMAS)[N]>;
type ReadOutput<N extends ReadOnlyToolName> = z.output<(typeof TOOL_OUTPUT_SCHEMAS)[N]>;

/**
 * What the server plugs in behind the five read tools.
 *
 * `rollOracle` is the one that WRITES — two journal lines and nothing else
 * (`ORACLE_JOURNAL_ONLY_EVENT_TYPES`). The roll itself is the engine's, on its
 * seeded stream: this signature hands the question over and receives the
 * already-settled answer, exactly like the rest of invariant 1.
 */
export interface ToolReadSource {
  get_state(input: ReadInput<'get_state'>): Promise<ReadOutput<'get_state'>>;
  get_lore(input: ReadInput<'get_lore'>): Promise<ReadOutput<'get_lore'>>;
  get_chronicle(input: ReadInput<'get_chronicle'>): Promise<ReadOutput<'get_chronicle'>>;
  check_name_allowed(
    input: ReadInput<'check_name_allowed'>,
  ): Promise<ReadOutput<'check_name_allowed'>>;
  roll_oracle(input: ReadInput<'roll_oracle'>): Promise<ReadOutput<'roll_oracle'>>;
}

/** What the server plugs in behind the seven proposals. It validates, adjusts or refuses. */
export interface ToolProposalSink {
  propose(
    tool: ProposalToolName,
    input: unknown,
  ): Promise<z.output<typeof TOOL_OUTPUT_SCHEMAS.propose_npc_introduce>>;
}

export interface ToolRuntime {
  readonly reads: ToolReadSource;
  readonly proposals: ToolProposalSink;
}

/**
 * THE READ / PROPOSAL FRONTIER — one definition, never a second copy.
 *
 * This set is what decides whether a call from the model is executed as a read
 * or handed to the proposal sink, which is the invariant-1 boundary on this
 * side of the port. It used to RETYPE the five names, and nothing compared the
 * copy to the tuple: measured in the M0-18 acceptance pass, deleting
 * `'roll_oracle'` from the literal left 127 tests out of 127 green, and sent
 * the one read tool that WRITES to the journal into `proposals.propose` where
 * no test looks. Emptying the whole literal failed a single test.
 *
 * It is built from `READ_ONLY_TOOL_NAMES` now, so there is nothing left to
 * drift from, and `tests/tool-surface.test.ts` walks all twelve tools through
 * `runToolCall` and pins the side each one lands on — the set and the routing
 * are both guarded, from two directions.
 */
const READ_NAMES: ReadonlySet<string> = new Set<string>(READ_ONLY_TOOL_NAMES);

/** Deterministic JSON: object keys sorted at every depth, no whitespace. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  });
}

const errorResult = (callId: string, message: string): NarratorToolResultBlock => ({
  type: 'tool_result',
  callId,
  content: stableJson({ error: message }),
  isError: true,
});

/**
 * Execute ONE tool call.
 *
 * A tool that does not apply to the current turn answers with an explicit
 * error result — it is never removed from the table, because a table that
 * varies destroys the prompt cache (section 3.1).
 */
export async function runToolCall(
  call: NarratorToolUseBlock,
  runtime: ToolRuntime,
): Promise<ToolCallOutcome> {
  if (!Object.hasOwn(TOOL_DEFINITIONS_BY_NAME, call.tool)) {
    return { kind: 'dropped', tool: call.tool, reason: 'unknown_tool' };
  }
  const name = call.tool as ToolName;
  const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(call.input);
  if (!parsed.success) {
    return { kind: 'dropped', tool: name, reason: 'invalid_arguments' };
  }

  if (READ_NAMES.has(name)) {
    const readName = name as ReadOnlyToolName;
    let produced: unknown;
    try {
      produced = await (runtime.reads[readName] as (input: unknown) => Promise<unknown>)(
        parsed.data,
      );
    } catch {
      return { kind: 'result', block: errorResult(call.callId, 'tool_unavailable') };
    }
    const checked = TOOL_OUTPUT_SCHEMAS[readName].safeParse(produced);
    if (!checked.success) {
      return { kind: 'result', block: errorResult(call.callId, 'tool_output_invalid') };
    }
    return {
      kind: 'result',
      block: {
        type: 'tool_result',
        callId: call.callId,
        content: stableJson(checked.data),
        isError: false,
      },
    };
  }

  const proposalName = name as ProposalToolName;
  let answered: unknown;
  try {
    answered = await runtime.proposals.propose(proposalName, parsed.data);
  } catch {
    return { kind: 'result', block: errorResult(call.callId, 'tool_unavailable') };
  }
  const checked = TOOL_OUTPUT_SCHEMAS[proposalName].safeParse(answered);
  if (!checked.success) {
    return { kind: 'result', block: errorResult(call.callId, 'tool_output_invalid') };
  }
  return {
    kind: 'result',
    block: {
      type: 'tool_result',
      callId: call.callId,
      content: stableJson(checked.data),
      isError: checked.data.status === 'rejected',
    },
  };
}
