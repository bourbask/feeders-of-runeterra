/**
 * THE ONLY PLACE IN THE SERVER THAT READS THE STORYTELLER'S CONFIGURATION
 * (01-architecture.md section 2.8).
 *
 * It lives under `ai/` rather than `game/` to sit next to the other modules
 * that speak to the port, and M0-24 owns it: M0-29 writes the rest of
 * `src/ai/**` and CONSUMES this without rewriting it.
 *
 * ── A DEVIATION, REPORTED RATHER THAN HIDDEN ─────────────────────────────
 * Section 2.8 prints `buildNarrator` as two lines: build a `NarratorConfig`
 * from `env.ts`, then call `selectNarrator()` from `@for/ai`. The first line
 * exists — `narratorConfig(env)` was delivered by M0-20. THE SECOND DOES NOT:
 * `@for/ai` currently exports one constant, its own name. M0-18 writes
 * `selectNarrator` and the four adapters IN THE SAME WAVE as this task, and
 * M0-24 does not depend on M0-18.
 *
 * So `buildNarrator` takes the selector as a PARAMETER, defaulting to the one
 * below. The day M0-18 lands, wiring it is `buildNarrator(env, selectNarrator)`
 * at the one call site, in `game/index.ts` — this file does not reopen, and no
 * adapter is written here. What IS written here is the `stub`, because the
 * simulator, the CI and every test in this repository have to run with no key
 * and no socket, and that is the port's own reason for existing
 * (02-mj-ia.md section 0.6: "`stub` n'est PAS un fournisseur").
 *
 * ── THE STUB SAYS NOTHING, ON PURPOSE ────────────────────────────────────
 * It returns an EMPTY text and `finish: 'complete'`. That is not a failure and
 * it is not an omission: the pipeline then writes the ENGINE's deterministic
 * fallback, picked on the `fallback` RNG stream, and marks it
 * `source: 'engine'` — which is exactly what the port's documentation promises
 * a stub does ("renders the engine's fallback templates with no socket open"),
 * and it is true rather than staged. A stub that invented a French sentence
 * would put prose in `@for/server`, where ARCHITECTURE.md section 4.3 says no
 * French narration may live, and would make `source: 'ai'` a lie.
 *
 * ── AN ABSENT ADAPTER DEGRADES THE PROSE, NOT THE GAME ───────────────────
 * `NARRATOR_PROVIDER=anthropic` with no adapter built yet returns a port that
 * RAISES `NarratorError('unavailable')` on every call, and the server starts
 * normally. Refusing to boot would have taken a deployment down over the one
 * thing that is allowed to degrade (02-mj-ia.md section 0.2: "on degrade la
 * prose, jamais l'equite"). The turn still resolves, the journal still grows,
 * and the players read the engine's sentence.
 */

import { NarratorError } from '@for/contracts';

import { narratorConfig } from '../env.js';

import type {
  NarrateEvent,
  NarrateRequest,
  NarratorCapabilities,
  NarratorConfig,
  NarratorPort,
  StructureRequest,
  StructureResult,
} from '@for/contracts';
import type { Env } from '../env.js';

/** What `@for/ai` will export, named here so the seam is typed today. */
export type NarratorSelector = (config: NarratorConfig) => NarratorPort;

/**
 * What a port with no network can honestly claim.
 *
 * `streaming: true` because the stub does emit the one-`delta`-then-`end`
 * shape the type describes; everything else is `false`, and
 * `contextWindowTokens` is the floor of 02-mj-ia.md section 4.3 rather than a
 * generous number nobody measured — a caller that budgets against it gets the
 * tightest budget, which is the safe direction to be wrong in.
 */
const STUB_CAPABILITIES: NarratorCapabilities = {
  streaming: true,
  tools: false,
  structuredOutput: false,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
};

/**
 * One event, as an `AsyncIterable`, with nothing to await.
 *
 * Written by hand rather than as `async function*`: a port that opens no
 * socket has nothing to wait for, and an `async` generator with no `await` is
 * a lie the lint refuses (`require-await`). The shape is the same to every
 * caller — `for await` reads it identically.
 */
function oneEvent(event: NarrateEvent): AsyncIterable<NarrateEvent> {
  const items = [event];
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = items[Symbol.iterator]();
      return { next: () => Promise.resolve(iterator.next()) };
    },
  };
}

function stubNarrator(): NarratorPort {
  return {
    providerId: 'stub',
    capabilities: STUB_CAPABILITIES,
    narrer: (request: NarrateRequest) =>
      oneEvent({
        type: 'end',
        result: {
          text: '',
          finish: 'complete',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          providerModel: `stub:${request.purpose}`,
          latencyMs: 0,
        },
      }),
    structurer: <T>(request: StructureRequest<T>): Promise<StructureResult<T>> => {
      // NOT a silent empty answer: a caller that asked for a shape and got a
      // fabricated one would validate it and carry on. The forge and the
      // chronicle need a real adapter (M0-18), and they must be told so.
      throw new NarratorError({
        code: 'unsupported',
        providerId: 'stub',
        message: `structurer(${request.schemaName}) demande un adaptateur réel (M0-18)`,
      });
    },
  };
}

/** A port for a provider whose adapter has not been written yet. */
function unavailableNarrator(config: NarratorConfig): NarratorPort {
  const raise = (): never => {
    throw new NarratorError({
      code: 'unavailable',
      providerId: config.provider,
      message: `aucun adaptateur « ${config.provider} » dans @for/ai (M0-18)`,
    });
  };
  return {
    providerId: config.provider,
    capabilities: { ...STUB_CAPABILITIES, streaming: false },
    // It raises AT THE CALL, inside the caller's `try`, which is where the
    // pipeline turns a storyteller failure into `narration.gm_failed` plus the
    // engine's sentence.
    narrer: () => raise(),
    structurer: () => raise(),
  };
}

/** The selector this file ships with, until `@for/ai` exports its own. */
export const builtinSelector: NarratorSelector = (config) =>
  config.provider === 'stub' ? stubNarrator() : unavailableNarrator(config);

/**
 * The port, built once, at start-up.
 *
 * `env` goes in and a `NarratorPort` comes out: nothing downstream of this
 * function knows a provider name, a base URL or a key exists, which is what
 * makes the eval harness runnable outside the server and the game layer
 * testable with no configuration at all.
 */
export function buildNarrator(env: Env, select: NarratorSelector = builtinSelector): NarratorPort {
  return select(narratorConfig(env));
}
