/**
 * The tool loop ABOVE the port (02-mj-ia.md section 0.1, contract 5).
 *
 * ── WHY THE LOOP IS HERE AND NOT IN AN ADAPTER ──────────────────────────────
 * `narrer()` is single-shot: it stops on `finish: 'tool_call'`. This file runs
 * the handler, appends a `tool_result` block and calls `narrer()` again, three
 * iterations at most, then `toolPolicy: 'none'`. An adapter that looped on its
 * own would put the model's proposals out of reach of the server's validation
 * — the whole point of invariant 1 is that nothing the model asks for becomes
 * true without the server saying so. Held by tests/degradation.test.ts « un
 * appel valide est exécuté, son résultat renvoyé, puis la prose suit » and
 * « et au-delà de trois itérations, la politique passe à none ».
 *
 * ── PROSE-ONLY, AND WHAT IT CHANGES HERE ────────────────────────────────────
 * ADR 0011: no tool definition is sent, on any turn. So the loop below is not
 * dead code — it is the guard that decides what happens when a model emits a
 * tool call NOBODY ASKED FOR, which is exactly what small models do. The
 * answer is the same as for a malformed one: the call is DROPPED,
 * `tool_call_dropped` is logged, and the request is replayed with
 * `toolPolicy: 'none'` to get the prose. Never repaired into a plausible
 * value — repairing, here, would be deciding in the place of the model that
 * decides in the place of the engine. Held by tests/degradation.test.ts « un
 * tool_call dont les arguments ne valident pas est abandonné, jamais réparé »,
 * whose entry request carries the twelve definitions and `toolPolicy: 'auto'`
 * so that the replay is read on what the CODE decided, and « et un appel non
 * sollicité, en mode prose seule, est traité pareil ».
 *
 * ── AND WHAT IT NEVER DOES ──────────────────────────────────────────────────
 * It produces text, usage counters and, at most, validated tool calls. It
 * never produces an `EngineEffect`, a `character.*` event or a `roll.*`
 * event: there is no code path here that could, and tests/degradation.test.ts
 * « et aucune ne fait sortir un EngineEffect, un character.* ni un roll.* »
 * replays all sixteen capability combinations and searches the bytes rather
 * than trusting this paragraph.
 */

import { TOOL_INPUT_SCHEMAS, type ToolName } from '@for/contracts';

import type {
  NarrateEvent,
  NarrateRequest,
  NarrateResult,
  NarratorMessage,
  NarratorPort,
  NarratorToolUseBlock,
} from '../narrator/port.js';
import { TOOL_LOOP_ITERATIONS_MAX } from '../tools/definitions.js';

/** What the caller does with one validated tool call. */
export type ToolExecutor = (
  call: NarratorToolUseBlock,
) => Promise<{ readonly content: string; readonly isError: boolean }>;

export type RunLogCode = 'tool_call_dropped' | 'tool_loop_exhausted';

export interface RunNarrationDeps {
  readonly narrator: NarratorPort;
  /** Forwarded verbatim; this is what `NarrationBroadcast` consumes. */
  readonly onEvent?: ((event: NarrateEvent) => void) | undefined;
  /** Absent in prose-only mode: every call is then dropped. */
  readonly executeTool?: ToolExecutor | undefined;
  readonly log?:
    ((code: RunLogCode, detail: Readonly<Record<string, unknown>>) => void) | undefined;
}

export interface RunNarrationResult {
  readonly text: string;
  readonly result: NarrateResult;
  /** Calls that were executed, in order. Empty in prose-only mode. */
  readonly executedCalls: readonly NarratorToolUseBlock[];
  /** Calls dropped for want of a schema, a valid input or an executor. */
  readonly droppedCalls: readonly NarratorToolUseBlock[];
  /** How many times `narrer()` was called. One in the ordinary case. */
  readonly iterations: number;
}

const isToolName = (name: string): name is ToolName =>
  Object.prototype.hasOwnProperty.call(TOOL_INPUT_SCHEMAS, name);

/**
 * Validate one call against the schema its handler validates with.
 *
 * Same schema, both sides: a JSON Schema typed by hand here would tell the
 * model one shape and check another, and nothing would notice (ADR 0007
 * applied to a pair that is not even an enum).
 */
function validateCall(call: NarratorToolUseBlock): boolean {
  if (!isToolName(call.tool)) return false;
  return TOOL_INPUT_SCHEMAS[call.tool].safeParse(call.input).success;
}

async function once(
  narrator: NarratorPort,
  request: NarrateRequest,
  onEvent: ((event: NarrateEvent) => void) | undefined,
): Promise<NarrateResult> {
  let last: NarrateResult | null = null;
  for await (const event of narrator.narrer(request)) {
    onEvent?.(event);
    if (event.type === 'end') last = event.result;
  }
  if (last === null) {
    // Contract 1 of section 0.1: exactly one `end`, always last. A stream that
    // ends without one is an adapter bug, not a case to handle downstream.
    throw new Error('flux terminé sans événement end — bug d’adaptateur (§0.1, contrat 1)');
  }
  return last;
}

/**
 * Run one narration to completion, tool loop included.
 *
 * `capabilities.tools === false` and prose-only mode land on the same
 * behaviour, and that is deliberate: `tools` is never sent, so whatever comes
 * back as a tool call was not asked for.
 */
export async function runNarration(
  request: NarrateRequest,
  deps: RunNarrationDeps,
): Promise<RunNarrationResult> {
  const supportsTools = deps.narrator.capabilities.tools && request.tools.length > 0;

  let current: NarrateRequest = supportsTools
    ? request
    : { ...request, tools: [], toolPolicy: 'none' };

  const executed: NarratorToolUseBlock[] = [];
  const dropped: NarratorToolUseBlock[] = [];
  let iterations = 0;
  let result = await once(deps.narrator, current, deps.onEvent);
  iterations += 1;

  while (result.finish === 'tool_call' && iterations <= TOOL_LOOP_ITERATIONS_MAX) {
    const results: NarratorMessage[] = [];
    let anyExecuted = false;

    for (const call of result.toolCalls) {
      if (deps.executeTool === undefined || !validateCall(call)) {
        dropped.push(call);
        deps.log?.('tool_call_dropped', { tool: call.tool, callId: call.callId });
        continue;
      }
      const answer = await deps.executeTool(call);
      executed.push(call);
      anyExecuted = true;
      results.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            callId: call.callId,
            content: answer.content,
            isError: answer.isError,
          },
        ],
      });
    }

    if (!anyExecuted) {
      // Nothing usable came back: ask for the prose and stop offering tools.
      current = { ...current, tools: [], toolPolicy: 'none' };
    } else {
      current = {
        ...current,
        messages: [
          ...current.messages,
          { role: 'assistant', content: result.toolCalls.map((call) => ({ ...call })) },
          ...results,
        ],
        ...(iterations >= TOOL_LOOP_ITERATIONS_MAX
          ? { tools: [], toolPolicy: 'none' as const }
          : {}),
      };
      if (iterations >= TOOL_LOOP_ITERATIONS_MAX) {
        deps.log?.('tool_loop_exhausted', { iterations });
      }
    }

    result = await once(deps.narrator, current, deps.onEvent);
    iterations += 1;
  }

  return { text: result.text, result, executedCalls: executed, droppedCalls: dropped, iterations };
}
