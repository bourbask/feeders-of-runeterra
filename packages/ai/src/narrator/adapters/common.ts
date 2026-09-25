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

import type {
  NarrateEvent,
  NarrateFinish,
  NarrateResult,
  NarratorProviderId,
  NarratorToolUseBlock,
  NarratorUsage,
} from '@for/contracts';

import { wrapUnknown } from '../http.js';

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
