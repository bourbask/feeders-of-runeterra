/**
 * The simulated transport the four adapters are exercised against.
 *
 * `tests/setup.ts` makes real egress fail, so every adapter here is handed a
 * `fetch` that answers from a script. That is not a convenience: it is what
 * lets the SAME contract be replayed against all four implementations, which
 * is the only way the port stays one port.
 */

import type { NarrateEvent, NarratorConfig, NarratorProviderId } from '@for/contracts';

import type { NarratorFetch } from '../src/narrator/http.js';

export const BASE_CONFIG: NarratorConfig = {
  provider: 'stub',
  baseUrl: null,
  apiKey: null,
  model: null,
  modelStructured: null,
  // Section 0.6: `probe` is the schema default, so it is what the fixtures use.
  tools: 'probe',
  timeoutMs: 60_000,
  contextWindowTokens: null,
};

export const configFor = (
  provider: NarratorProviderId,
  over: Partial<NarratorConfig> = {},
): NarratorConfig => ({
  ...BASE_CONFIG,
  provider,
  ...(provider === 'anthropic' ? { apiKey: 'k', model: 'm', modelStructured: 'ms' } : {}),
  ...(provider === 'openai-compatible'
    ? { apiKey: 'k', baseUrl: 'https://gateway.invalid/v1', model: 'm', modelStructured: 'ms' }
    : {}),
  ...(provider === 'ollama'
    ? { baseUrl: 'http://localhost:11434', model: 'm', modelStructured: 'ms' }
    : {}),
  ...over,
});

/**
 * A streaming body built from already-framed lines, delivered LAZILY.
 *
 * Lazy matters: a body that pushes everything at once cannot be interrupted,
 * and the abort half of the port contract would pass without ever exercising
 * an abort. Handed a signal, this body errors the stream the way a real
 * transport does.
 */
export function streamResponse(
  lines: readonly string[],
  options: { readonly status?: number; readonly signal?: AbortSignal } = {},
): Response {
  const encoder = new TextEncoder();
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.signal?.aborted === true) {
        controller.error(new DOMException('aborted', 'AbortError'));
        return;
      }
      if (at >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${lines[at] ?? ''}\n`));
      at += 1;
    },
  });
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export const sse = (frames: readonly unknown[]): readonly string[] =>
  frames.flatMap((frame) => [`data: ${JSON.stringify(frame)}`, '']);

export const ndjson = (frames: readonly unknown[]): readonly string[] =>
  frames.map((frame) => JSON.stringify(frame));

/** A transport that always answers the same thing, and records what it was asked. */
export function scriptedFetch(answer: () => Response): NarratorFetch & {
  readonly calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  };
  return Object.assign(impl, { calls });
}

export async function collect(stream: AsyncIterable<NarrateEvent>): Promise<NarrateEvent[]> {
  const events: NarrateEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
