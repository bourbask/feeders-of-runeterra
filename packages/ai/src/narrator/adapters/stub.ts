/**
 * The `stub` implementation of the port — no socket, ever.
 *
 * It is NOT a vendor (section 0.6): it is what lets the CI, the simulator and
 * the offline eval run with no key at all, and it is the single degraded-mode
 * switch of the system — `AI_ENABLED` does not exist.
 *
 * ── WHERE ITS TEXT COMES FROM, AND WHY IT IS INJECTED ───────────────────────
 * Section 0.6 says the stub renders the engine's fallback templates
 * (`content/fallbacks/narration.json`). That file is the ONE content path with
 * no schema, and `@for/content` lists it in `UNVALIDATED_PATHS` rather than
 * exposing it on the registry — so there is nothing to read it from today.
 * The texts are therefore handed in, and a short built-in line is used when
 * nobody hands any: injection keeps this package free of a content shape it
 * cannot validate, and keeps the choice deterministic either way.
 *
 * ── WHY THE CHOICE IS A HASH OF `requestId` ─────────────────────────────────
 * Invariant 4: the same turn replayed must give the same text. A counter or a
 * random pick would make the stub the one non-replayable piece of an
 * otherwise replayable pipeline.
 *
 * ── WHY `structurer()` REFUSES ──────────────────────────────────────────────
 * `structuredOutput` is false and there is no model behind this port to ask,
 * so forge, chronicle and judge are simply unavailable with
 * `NARRATOR_PROVIDER=stub`. `unsupported` says exactly that; inventing a value
 * would mean the stub deciding what a campaign remembers.
 */

import {
  NarratorError,
  type NarrateEvent,
  type NarrateRequest,
  type NarratorCapabilities,
  type NarratorConfig,
  type NarratorPort,
  type StructureRequest,
  type StructureResult,
} from '@for/contracts';

import { driveStream, ZERO_USAGE, type ProviderEvent } from './common.js';

/** Section 0.5's window, reused: the stub stands in for the poorest provider, not the richest. */
export const STUB_CONTEXT_WINDOW_TOKENS = 8192;

/**
 * A single sentence-run that satisfies the form rules of section 2.1 — three
 * to five sentences, second person singular, no figure, no rule word, ending
 * on a fact rather than an atmosphere.
 */
const BUILT_IN_TEXT =
  'Tu passes. La corde tient sous ta main et la neige cède au bord du pas. Personne ne dit rien. En contrebas, quelque chose bouge et s’arrête.';

export interface StubNarratorOptions {
  /** Fallback templates, already rendered. Empty ⇒ the built-in line. */
  readonly texts?: readonly string[];
  /** How many `delta` events one text is cut into. At least one. */
  readonly chunks?: number;
  readonly now?: () => number;
}

/** FNV-1a, 32 bits. Small, stable across runs, and not a hash of security interest. */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function cut(text: string, pieces: number): readonly string[] {
  if (pieces <= 1 || text.length === 0) return [text];
  const size = Math.ceil(text.length / pieces);
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

export function createStubNarrator(
  config: NarratorConfig,
  options: StubNarratorOptions = {},
): NarratorPort {
  const texts =
    options.texts !== undefined && options.texts.length > 0 ? options.texts : [BUILT_IN_TEXT];
  const capabilities: NarratorCapabilities = Object.freeze({
    streaming: true,
    tools: false,
    structuredOutput: false,
    promptCache: false,
    contextWindowTokens: config.contextWindowTokens ?? STUB_CONTEXT_WINDOW_TOKENS,
    maxCacheBreakpoints: 0,
  });

  return {
    providerId: 'stub',
    capabilities,

    narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
      const picked = texts[hash32(req.requestId) % texts.length] ?? BUILT_IN_TEXT;
      const pieces = cut(picked, options.chunks ?? 2);
      return driveStream({
        providerId: 'stub',
        requestedModel: config.model ?? 'stub',
        abortSignal: req.abortSignal,
        now: options.now,
        frames: async function* frames(): AsyncGenerator<ProviderEvent> {
          // Nothing to wait for: the stub opens nothing. The generator stays
          // asynchronous so the port contract test walks the same code path
          // here as it does against the three networked adapters.
          await Promise.resolve();
          for (const piece of pieces) {
            if (req.abortSignal?.aborted === true) return;
            yield { type: 'delta', text: piece };
          }
          yield { type: 'usage', usage: ZERO_USAGE };
          yield { type: 'finish', finish: 'complete' };
        },
      });
    },

    structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
      return Promise.reject(
        new NarratorError({
          code: 'unsupported',
          providerId: 'stub',
          message: `stub: structurer(${req.purpose}) needs a model behind the port`,
        }),
      );
    },
  };
}
