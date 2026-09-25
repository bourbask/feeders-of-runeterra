/**
 * The `ollama` adapter (02-mj-ia.md section 0.5).
 *
 * Target: a model running on the machine of whoever hosts the table. Zero
 * cost, nothing leaves the house, much poorer prose — a development and
 * emergency mode, not the nominal one.
 *
 * ── WHAT IS SPECIFIC HERE, AND WHY ──────────────────────────────────────────
 * - NDJSON, one JSON object per line, never SSE.
 * - `NARRATOR_API_KEY` is IGNORED and may be empty. That is the one exception
 *   to "a missing variable stops the process", and it is deliberate: a local
 *   server has nothing to authenticate.
 * - `tools` is FALSE BY DEFAULT. Models small enough for a player's machine
 *   call tools unreliably, and a prose peppered with pseudo tool calls is
 *   worse than prose with no tools at all. `NARRATOR_TOOLS=on` forces the try.
 * - The window is narrow — often 8 k — against a spec that aims at 14 000
 *   input tokens. That is the sizing constraint of this adapter, and section
 *   4.3's budget already accounts for it: `min(14 000, window x 0,6)`.
 * - A cold start goes past sixty seconds WITHOUT BEING A FAILURE. Hence
 *   `NARRATOR_TIMEOUT_MS`, and hence `timeout` being retryable.
 */

import {
  NarratorError,
  type NarrateEvent,
  type NarrateRequest,
  type NarratorCapabilities,
  type NarratorConfig,
  type NarratorMessage,
  type NarratorPort,
  type NarratorTextBlock,
  type NarratorToolSpec,
  type StructureRequest,
  type StructureResult,
} from '@for/contracts';
import { z } from 'zod';

import { errorFromResponse, readNdjson, wrapUnknown, type NarratorFetch } from '../http.js';
import { extractAndValidate } from '../structured.js';
import { driveStream, type ProviderEvent } from './common.js';

const PROVIDER = 'ollama' as const;

/** Section 0.5. The dimensioning constraint of this adapter. */
export const OLLAMA_CONTEXT_WINDOW_TOKENS = 8192;

/** A provider field is `unknown` until proven otherwise; never stringify one blindly. */
const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

export interface OllamaNarratorOptions {
  readonly fetch: NarratorFetch;
  readonly now?: () => number;
}

const systemText = (system: readonly NarratorTextBlock[]): string =>
  system.map((block) => block.text).join('\n\n');

function wireMessages(messages: readonly NarratorMessage[]): readonly unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    const texts: string[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          texts.push(block.text);
          break;
        case 'tool_use':
          texts.push(JSON.stringify(block.input));
          break;
        case 'tool_result':
          out.push({ role: 'tool', content: block.content });
          break;
      }
    }
    if (texts.length === 0) continue;
    out.push({ role: message.role, content: texts.join('\n\n') });
  }
  return out;
}

const wireTools = (tools: readonly NarratorToolSpec[]): readonly unknown[] =>
  tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));

export function createOllamaNarrator(
  config: NarratorConfig,
  options: OllamaNarratorOptions,
): NarratorPort {
  if (config.baseUrl === null || config.baseUrl.length === 0) {
    throw new NarratorError({
      code: 'bad_request',
      providerId: PROVIDER,
      message: 'NARRATOR_BASE_URL is required by this provider',
    });
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const window = config.contextWindowTokens ?? OLLAMA_CONTEXT_WINDOW_TOKENS;

  const capabilities: NarratorCapabilities = Object.freeze({
    streaming: true,
    // False unless explicitly forced: section 0.5, and section 0.6's per-adapter column.
    tools: config.tools === 'on',
    // `format` accepts a JSON Schema; the MODEL is what does not guarantee it,
    // which is why `structurer()` revalidates and section 0.2 takes over.
    structuredOutput: true,
    promptCache: false,
    contextWindowTokens: window,
    maxCacheBreakpoints: 0,
  });

  const post = async (body: unknown, signal: AbortSignal | undefined): Promise<Response> => {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    };
    let response: Response;
    try {
      response = await options.fetch(`${base}/api/chat`, init);
    } catch (cause) {
      throw wrapUnknown(cause, PROVIDER);
    }
    if (!response.ok) throw await errorFromResponse(response, PROVIDER);
    return response;
  };

  return {
    providerId: PROVIDER,
    capabilities,

    narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
      const model = config.model ?? '';
      const body = {
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemText(req.system) },
          ...wireMessages(req.messages),
        ],
        options: { num_predict: req.maxOutputTokens, num_ctx: window },
        ...(capabilities.tools ? { tools: wireTools(req.tools) } : {}),
      };

      return driveStream({
        providerId: PROVIDER,
        requestedModel: model,
        abortSignal: req.abortSignal,
        ...(options.now === undefined ? {} : { now: options.now }),
        frames: async function* frames(): AsyncGenerator<ProviderEvent> {
          const response = await post(body, req.abortSignal);
          /**
           * WHETHER A TOOL CALL WAS SEEN IS A PROPERTY OF THE STREAM, NOT OF A
           * LINE. This server puts `tool_calls` on a message line and `done`
           * on a LATER one, with `done_reason: 'stop'` either way. Read per
           * line, the finish came out `complete` while a call had just been
           * decoded — and `driveStream` then drops `result.toolCalls`, which
           * is how a decoded call reached the caller as an event and as an
           * empty list at the same time. Measured: nothing exercised this path
           * at all (`common.ts` lines 91-94, the whole `tool_call` case, were
           * uncovered).
           */
          let sawToolCall = false;
          for await (const raw of readNdjson(response)) {
            const payload = raw as Record<string, unknown>;
            const error = payload['error'];
            if (typeof error === 'string') {
              throw new NarratorError({
                code: 'unavailable',
                providerId: PROVIDER,
                message: 'provider error line',
                providerDetail: error.slice(0, 2000),
              });
            }
            const model2 = payload['model'];
            if (typeof model2 === 'string' && model2.length > 0) {
              yield { type: 'model', model: model2 };
            }
            const message = payload['message'] as Record<string, unknown> | undefined;
            const content = message?.['content'];
            if (typeof content === 'string' && content.length > 0) {
              yield { type: 'delta', text: content };
            }
            const calls = message?.['tool_calls'] as Record<string, unknown>[] | undefined;
            for (const call of calls ?? []) {
              const fn = call['function'] as Record<string, unknown> | undefined;
              if (fn === undefined) continue;
              sawToolCall = true;
              yield {
                type: 'tool_call',
                call: {
                  type: 'tool_use',
                  callId: textOr(call['id'], textOr(fn['name'], '')),
                  tool: textOr(fn['name'], ''),
                  input: fn['arguments'] ?? {},
                },
              };
            }
            if (payload['done'] !== true) continue;
            yield {
              type: 'usage',
              usage: {
                inputTokens: (payload['prompt_eval_count'] as number | undefined) ?? 0,
                outputTokens: (payload['eval_count'] as number | undefined) ?? 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            };
            const reason = payload['done_reason'];
            yield {
              type: 'finish',
              finish: reason === 'length' ? 'truncated' : sawToolCall ? 'tool_call' : 'complete',
            };
          }
        },
      });
    },

    async structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
      const model = config.modelStructured ?? config.model ?? '';
      const clock = options.now ?? (() => Date.now());
      const startedAt = clock();
      const response = await post(
        {
          model,
          stream: false,
          messages: [
            { role: 'system', content: systemText(req.system) },
            ...wireMessages(req.messages),
          ],
          format: z.toJSONSchema(req.schema, { io: 'input' }),
          options: { num_predict: req.maxOutputTokens, num_ctx: window },
        },
        req.abortSignal,
      );
      let payload: Record<string, unknown>;
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        throw wrapUnknown(cause, PROVIDER);
      }
      const message = payload['message'] as Record<string, unknown> | undefined;
      const text = typeof message?.['content'] === 'string' ? message['content'] : '';
      return {
        value: extractAndValidate(req.schema, text, PROVIDER),
        usage: {
          inputTokens: (payload['prompt_eval_count'] as number | undefined) ?? 0,
          outputTokens: (payload['eval_count'] as number | undefined) ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        providerModel: textOr(payload['model'], model),
        latencyMs: clock() - startedAt,
        repairPasses: 0,
      };
    },
  };
}
