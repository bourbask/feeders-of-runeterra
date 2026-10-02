/**
 * The skeleton the three networked adapters share.
 *
 * Contract 1 to 4 of section 0.1 are properties of this file, not of each
 * adapter: exactly one `end` and always last, `result.text` equal to the
 * ordered concatenation of the `delta`s, a `NarratorError` and nothing else
 * thrown from the iterator, and an abort that still ends with `finish:
 * 'aborted'` CARRYING THE PARTIAL TEXT. Writing them three times is how two of
 * the three end up subtly different, and the port contract test is rerun
 * against all four implementations precisely because that has happened
 * elsewhere.
 *
 * The partial text on abort is not a nicety: section 6.4 persists it. A
 * deployment in the middle of a generation loses what was never handed over.
 */

import { NarratorError } from '@for/contracts';

import { wrapUnknown } from '../http.js';

import type {
  NarrateEvent,
  NarrateFinish,
  NarrateResult,
  NarratorProviderId,
  NarratorToolUseBlock,
  NarratorUsage,
} from '@for/contracts';

/**
 * The model name an adapter is about to put on the wire, or a refusal.
 *
 * `ollama` and `openai-compatible` HAVE NO SENSIBLE DEFAULT MODEL, unlike
 * `anthropic`: one serves whatever the host happens to have pulled, the other
 * whatever its gateway exposes. Inventing a name for either would trade an
 * empty `model` for a wrong one — the same 400, one step further from the
 * cause.
 *
 * Before this guard the two sent `config.model ?? ''`, and a real provider
 * answered 400 while the turn fell back to the engine's deterministic prose.
 * The fallback worked so well that nothing went red; issue #89 was found by
 * reading the BODY of the request, not by checking that one was sent.
 *
 * `packages/server/src/env.ts` refuses to boot these two providers without
 * `NARRATOR_MODEL`, so the server can never reach here. `@for/ai` is called
 * outside the server too — the eval harness builds its own `NarratorConfig` —
 * which is what keeps this reachable rather than decorative.
 *
 * HELD BY tests/narrator-model-required.test.ts « n'envoie aucune requête
 * quand le modèle manque ».
 */
export function requireModel(
  model: string | null | undefined,
  providerId: NarratorProviderId,
): string {
  if (model !== undefined && model !== null && model.trim() !== '') return model;
  throw new NarratorError({
    code: 'model_not_found',
    providerId,
    message: `NARRATOR_MODEL est obligatoire pour « ${providerId} » : cet adaptateur n'a pas de modèle par défaut`,
  });
}

export const ZERO_USAGE: NarratorUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** What an adapter's frame reader reports, before the port's own bookkeeping. */
export type ProviderEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: NarratorToolUseBlock }
  | { readonly type: 'finish'; readonly finish: NarrateFinish }
  | { readonly type: 'usage'; readonly usage: NarratorUsage }
  | { readonly type: 'model'; readonly model: string };

export interface DriveOptions {
  readonly providerId: NarratorProviderId;
  /** What `providerModel` says when the provider echoes nothing back. */
  readonly requestedModel: string;
  readonly abortSignal?: AbortSignal | undefined;
  /** Wall clock, injected so a test can pin `latencyMs`. */
  readonly now?: (() => number) | undefined;
  readonly frames: () => AsyncIterable<ProviderEvent>;
}

/**
 * Turn a stream of provider frames into the port's stream.
 *
 * `finish` defaults to `'complete'`: a provider that stops without saying why
 * has finished its sentence as far as the port is concerned. `'truncated'`,
 * `'tool_call'` and `'refused'` are always said explicitly by the frames.
 */
export async function* driveStream(options: DriveOptions): AsyncGenerator<NarrateEvent> {
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();
  const chunks: string[] = [];
  const toolCalls: NarratorToolUseBlock[] = [];
  let finish: NarrateFinish = 'complete';
  let usage: NarratorUsage = ZERO_USAGE;
  let model = options.requestedModel;

  const end = (): NarrateEvent => {
    const result: NarrateResult = {
      text: chunks.join(''),
      finish,
      toolCalls: finish === 'tool_call' ? [...toolCalls] : [],
      usage,
      providerModel: model,
      latencyMs: clock() - startedAt,
    };
    return { type: 'end', result };
  };

  try {
    for await (const frame of options.frames()) {
      switch (frame.type) {
        case 'delta': {
          if (frame.text.length === 0) break;
          chunks.push(frame.text);
          yield { type: 'delta', text: frame.text };
          break;
        }
        case 'tool_call': {
          toolCalls.push(frame.call);
          yield { type: 'tool_call', call: frame.call };
          break;
        }
        case 'finish': {
          finish = frame.finish;
          break;
        }
        case 'usage': {
          usage = frame.usage;
          break;
        }
        case 'model': {
          model = frame.model;
          break;
        }
      }
    }
  } catch (cause) {
    // An abort is not a failure: section 0.1 contract 4 wants the partial text
    // handed over, which is why it ends the stream instead of throwing.
    if (options.abortSignal?.aborted === true) {
      finish = 'aborted';
      yield end();
      return;
    }
    throw wrapUnknown(cause, options.providerId);
  }

  if (options.abortSignal?.aborted === true) finish = 'aborted';
  yield end();
}
