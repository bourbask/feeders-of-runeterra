/**
 * `selectNarrator(config)` — the one place in `@for/ai` that names the four
 * implementations (02-mj-ia.md section 0.6).
 *
 * It names them because it has to choose between them, and the acceptance
 * criterion of M0-18 greps `packages/ai/src` OUTSIDE `narrator/` for exactly
 * that reason: this file and `adapters/` are the two places a vendor word is
 * allowed to appear, everything above is written against the port.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * It does not read the environment. `packages/server/src/env.ts` is the only
 * place in the system that does: it builds the `NarratorConfig` once at
 * start-up and passes it here. `tests/no-env.test.ts` scans every source file
 * of this package for an environment read and fails on the first — the
 * criterion is a grep that must print zero, so even NAMING the accessor in a
 * comment would fail it. That boundary is what makes the eval harness runnable
 * with no server at all.
 *
 * ── WHY THE TRANSPORT IS OPTIONAL AND THE STUB NEEDS NONE ───────────────────
 * With no `fetch` handed in, the three networked adapters take the ambient
 * one. The stub takes none, ever: `NARRATOR_PROVIDER=stub` is the single
 * degraded-mode switch of the system, and its defining property is that no
 * socket opens.
 */

import { NarratorError, type NarratorConfig, type NarratorPort } from '@for/contracts';

import { createAnthropicNarrator } from './adapters/anthropic.js';
import { createOllamaNarrator } from './adapters/ollama.js';
import { createOpenAiCompatibleNarrator } from './adapters/openai-compatible.js';
import { createStubNarrator, type StubNarratorOptions } from './adapters/stub.js';
import type { NarratorFetch } from './http.js';

export interface SelectNarratorDeps {
  /** Injected by tests and by the server. Defaults to the ambient `fetch`. */
  readonly fetch?: NarratorFetch;
  readonly now?: () => number;
  readonly stub?: StubNarratorOptions;
  /** Outcome of the start-up tool probe, when one has been run (M0-31). */
  readonly toolsProbeResult?: boolean;
}

const ambientFetch = (): NarratorFetch => {
  const found = globalThis.fetch;
  if (typeof found !== 'function') {
    throw new NarratorError({
      code: 'unsupported',
      providerId: 'stub',
      message: 'no fetch implementation available for a networked provider',
    });
  }
  return (url, init) => found(url, init);
};

export function selectNarrator(
  config: NarratorConfig,
  deps: SelectNarratorDeps = {},
): NarratorPort {
  switch (config.provider) {
    case 'stub':
      return createStubNarrator(config, deps.stub ?? {});
    case 'anthropic':
      return createAnthropicNarrator(config, {
        fetch: deps.fetch ?? ambientFetch(),
        ...(deps.now === undefined ? {} : { now: deps.now }),
      });
    case 'openai-compatible':
      return createOpenAiCompatibleNarrator(config, {
        fetch: deps.fetch ?? ambientFetch(),
        ...(deps.now === undefined ? {} : { now: deps.now }),
        ...(deps.toolsProbeResult === undefined ? {} : { toolsProbeResult: deps.toolsProbeResult }),
      });
    case 'ollama':
      return createOllamaNarrator(config, {
        fetch: deps.fetch ?? ambientFetch(),
        ...(deps.now === undefined ? {} : { now: deps.now }),
      });
  }
}
