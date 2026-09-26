/**
 * `NarratorPort`, without a model. The whole point of this file is that the
 * simulator runs with no key, no socket and no local weights.
 *
 * ── WHY IT IS NOT THE SERVER'S `stub`, AND WHY THAT MATTERS ──────────────
 * `buildNarrator(env)` with `NARRATOR_PROVIDER=stub` answers an EMPTY text, so
 * the pipeline always takes its `spoken === false` branch and writes
 * `narration.gm_message { source: 'engine' }`. A simulator built on it would
 * never once exercise the branch that runs in production —
 * `source: 'ai'`, the `delta` accumulation, `providerModel` copied off the
 * `end` event. This port answers a NON-EMPTY deterministic text, so both
 * branches of `narrate()` are reachable from a scenario, and `withFailure()`
 * reaches the third.
 *
 * ── THERE IS NO FICTION IN HERE, ON PURPOSE ──────────────────────────────
 * What it writes is a line of IDENTIFIERS read back off the brief — the move,
 * the outcome, the actor — not prose. Two reasons, and neither is style:
 * invented French would put narration in a tooling package, and a sentence
 * nobody wrote for a player would end up quoted in a golden corpus as though
 * it were content. The line is stable, legible in a diff, and says where it
 * came from.
 *
 * ── WHAT IT IS AND IS NOT ALLOWED TO DECIDE (invariant 1) ────────────────
 * Nothing. It reads the brief and returns text. It never returns a tool call,
 * `structurer()` refuses, and the one thing it echoes — the outcome — was
 * decided by `@for/engine` before this port was called and is already in the
 * journal. `tests/scenarios.test.ts`, « le conteur scripté ne décide rien :
 * aucun appel d'outil, `structurer` refuse », holds both halves.
 */

import { NarratorError } from '@for/contracts';

import type {
  NarrateEvent,
  NarrateRequest,
  NarratorCapabilities,
  NarratorPort,
  StructureRequest,
  StructureResult,
} from '@for/contracts';

/** What a port with no network can honestly claim. Mirrors the server's stub. */
const SCRIPTED_CAPABILITIES: NarratorCapabilities = {
  streaming: true,
  tools: false,
  structuredOutput: false,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
};

/** The model name this port reports. Copied into `narration.gm_message.model`. */
export const SCRIPTED_PROVIDER_MODEL = 'scripted:sim';

/** The fields of the brief this port is allowed to echo. Nothing else. */
interface BriefEcho {
  readonly moveId: string;
  readonly outcome: string;
  readonly actorCharacterId: string;
  readonly correlationId: string;
}

/**
 * The brief, read back out of the request.
 *
 * `intent-pipeline.ts` sends it as JSON in one user text block. This is a
 * READ of what the server sent, never a second source: a brief that does not
 * parse yields `null`, and the port then says nothing rather than inventing a
 * turn.
 */
function echoOf(request: NarrateRequest): BriefEcho | null {
  const block = request.messages[0]?.content[0];
  if (block?.type !== 'text') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const brief = parsed as Record<string, unknown>;
  return {
    moveId: typeof brief['moveId'] === 'string' ? brief['moveId'] : 'aucun',
    outcome: typeof brief['outcome'] === 'string' ? brief['outcome'] : 'aucune',
    actorCharacterId:
      typeof brief['actorCharacterId'] === 'string' ? brief['actorCharacterId'] : 'inconnu',
    correlationId: typeof brief['correlationId'] === 'string' ? brief['correlationId'] : 'inconnu',
  };
}

/** The one line this port writes. Identifiers, and a marker that names it. */
export function scriptedNarration(request: NarrateRequest): string {
  const echo = echoOf(request);
  if (echo === null) return '';
  return `[conteur-scripte] mouvement=${echo.moveId} issue=${echo.outcome} acteur=${echo.actorCharacterId}`;
}

export interface ScriptedNarratorOptions {
  /**
   * What to write. Replaced by a test that needs the port to say something
   * particular — that is how `checks/lockout.ts` is shown to bite.
   */
  readonly text?: (request: NarrateRequest) => string;
  /** Cut the text into this many `delta` events. At least one. */
  readonly chunks?: number;
  /** When set, `narrer()` raises instead: the `narration.gm_failed` path. */
  readonly failWith?: string;
}

/**
 * Hand-written rather than `async function*`, for the reason the server's own
 * stub gives: a port that opens no socket has nothing to await, and an `async`
 * generator with no `await` is a claim the lint refuses.
 */
function stream(events: readonly NarrateEvent[]): AsyncIterable<NarrateEvent> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = events[Symbol.iterator]();
      return { next: () => Promise.resolve(iterator.next()) };
    },
  };
}

function cut(text: string, chunks: number): readonly string[] {
  if (text.length === 0) return [];
  const size = Math.max(1, Math.ceil(text.length / Math.max(1, chunks)));
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));
  return pieces;
}

export function createScriptedNarrator(options: ScriptedNarratorOptions = {}): NarratorPort {
  const write = options.text ?? scriptedNarration;
  const chunks = options.chunks ?? 3;

  return {
    providerId: 'stub',
    capabilities: SCRIPTED_CAPABILITIES,
    narrer: (request: NarrateRequest): AsyncIterable<NarrateEvent> => {
      if (options.failWith !== undefined) {
        throw new NarratorError({
          code: 'unavailable',
          providerId: 'stub',
          message: options.failWith,
        });
      }
      const text = write(request);
      const deltas: NarrateEvent[] = cut(text, chunks).map((piece) => ({
        type: 'delta',
        text: piece,
      }));
      return stream([
        ...deltas,
        {
          type: 'end',
          result: {
            text,
            finish: 'complete',
            // EMPTY, AND IT HAS TO BE. A tool call from this port would be the
            // model reaching a decision, which invariant 1 forbids and which
            // no scenario could ever legitimately assert.
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            providerModel: SCRIPTED_PROVIDER_MODEL,
            latencyMs: 0,
          },
        },
      ]);
    },
    structurer: <T>(request: StructureRequest<T>): Promise<StructureResult<T>> => {
      // NOT a fabricated value: the forge and the chronicle need a real
      // adapter, and a caller handed an invented shape would validate it and
      // carry on.
      throw new NarratorError({
        code: 'unsupported',
        providerId: 'stub',
        message: `structurer(${request.schemaName}) n'a pas de place dans un simulateur sans modèle`,
      });
    },
  };
}
