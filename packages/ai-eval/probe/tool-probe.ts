/**
 * The start-up capability probe of section 0.4 — « does this model actually
 * call a tool? » (M0-31).
 *
 * ── WHY IT EXISTS AT ALL, GIVEN THAT M0 IS PROSE-ONLY ───────────────────────
 * ADR 0011 sends `tools: []` on every turn, so nothing in M0 depends on the
 * answer. But `openai-compatible` announces `tools: false` and WAITS TO BE
 * TOLD otherwise — `SelectNarratorDeps.toolsProbeResult` names M0-31 in its
 * own comment — and the capability matrix this task has to publish would
 * otherwise print a default rather than a measurement. A capability announced
 * without being measured is exactly the failure the probe exists to prevent.
 *
 * ── IT NEVER RUNS WITHOUT A SOCKET ──────────────────────────────────────────
 * One short call, one trivial tool, `toolPolicy: 'auto'`. On `stub` it is
 * not attempted at all: the stub's defining property is that no socket opens,
 * and reporting `tools: false` for it is reading its capabilities, not probing
 * them. Held by `tool-probe.test.ts` « n'ouvre rien sur le stub ».
 *
 * ── A FAILED PROBE IS NOT A FAILED PROVIDER ─────────────────────────────────
 * Timeout, refusal, unsupported: the answer is `false` with the reason
 * attached, and the measurement goes on. A provider that cannot call tools is
 * a known degradation (section 0.2), not an error — and in prose-only mode it
 * is not even a degradation.
 */

import { NarratorError } from '@for/contracts';

import type { NarrateRequest, NarratorPort, NarratorToolSpec } from '@for/contracts';

/**
 * The smallest tool that still forces a decision: one string argument.
 *
 * `toolPolicy` is `'auto'` because the port has only two values, `'auto'` and
 * `'none'` — there is no `'required'` to lean on, so the probe measures what
 * the product would measure: a model offered a tool, free to use it.
 */
export const PROBE_TOOL: NarratorToolSpec = Object.freeze({
  name: 'check_name_allowed',
  description:
    "Vérifie qu'un nom de personnage peut être employé dans la narration. Appelle-le une fois.",
  inputSchema: Object.freeze({
    type: 'object' as const,
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false as const,
  }),
});

export interface ToolProbeOutcome {
  /** False when the probe was not attempted — see `detail` for why. */
  readonly ran: boolean;
  /** The measurement. False when `ran` is false. */
  readonly toolCallSeen: boolean;
  readonly detail: string;
}

export const TOOL_PROBE_TIMEOUT_MS = 120_000;

/**
 * Ask the port for one tool call and say whether one came back.
 *
 * `port.capabilities.tools === false` short-circuits: the adapter would not
 * transmit the tool table, so the call would measure the adapter's switch
 * rather than the model. That is reported as « not attempted », never as
 * « the model cannot ».
 */
export async function probeTools(
  port: NarratorPort,
  timeoutMs: number = TOOL_PROBE_TIMEOUT_MS,
): Promise<ToolProbeOutcome> {
  if (port.providerId === 'stub') {
    return { ran: false, toolCallSeen: false, detail: 'stub : aucune socket, rien à sonder' };
  }
  if (!port.capabilities.tools) {
    return {
      ran: false,
      toolCallSeen: false,
      detail:
        "l'adaptateur n'émet pas la table d'outils (capabilities.tools = false) : poser NARRATOR_TOOLS=on pour mesurer le modèle",
    };
  }
  const request: NarrateRequest = {
    purpose: 'narration',
    requestId: 'probe-tools',
    system: [{ type: 'text', text: 'Tu disposes d’un outil. Utilise-le, sans écrire de prose.' }],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Vérifie si le nom « Ulrun » est autorisé.' }],
      },
    ],
    tools: [PROBE_TOOL],
    toolPolicy: 'auto',
    maxOutputTokens: 128,
    effort: 'low',
    abortSignal: AbortSignal.timeout(timeoutMs),
  };
  try {
    for await (const event of port.narrer(request)) {
      if (event.type === 'tool_call') {
        return { ran: true, toolCallSeen: true, detail: `appel observé : ${event.call.tool}` };
      }
      if (event.type === 'end') {
        return event.result.toolCalls.length > 0
          ? {
              ran: true,
              toolCallSeen: true,
              detail: `appel observé : ${event.result.toolCalls.map((call) => call.tool).join(', ')}`,
            }
          : {
              ran: true,
              toolCallSeen: false,
              detail: `aucun appel (fin « ${event.result.finish} »)`,
            };
      }
    }
    return { ran: true, toolCallSeen: false, detail: 'flux clos sans événement de fin' };
  } catch (cause) {
    const reason =
      cause instanceof NarratorError
        ? `${cause.code} — ${cause.message}`
        : cause instanceof Error
          ? cause.message
          : String(cause);
    return { ran: true, toolCallSeen: false, detail: `sonde en échec : ${reason}` };
  }
}
