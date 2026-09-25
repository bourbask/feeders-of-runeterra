/**
 * The `openai-compatible` adapter (02-mj-ia.md section 0.4).
 *
 * The most widespread wire format, and the one that makes the product
 * playable with no budget: free gateways, aggregators and self-hosted servers
 * all speak it. No SDK — `fetch` and an SSE reader — because the whole point
 * is to be able to point it at anything.
 *
 * ── THE THREE THINGS THIS FORMAT DOES BADLY, AND WHAT WE DO ABOUT THEM ──────
 * 1. TOOL SUPPORT DEPENDS ON THE MODEL, NOT ON THE GATEWAY. The same endpoint
 *    serves models that call tools and models that describe a tool call in
 *    prose. Hence `NARRATOR_TOOLS`. With `probe`, this adapter announces
 *    `tools: false` and waits to be TOLD otherwise: the start-up probe is a
 *    network call, it never runs in CI, and a capability announced true
 *    without measurement is the failure the probe exists to prevent.
 *    `toolsProbeResult` is how M0-31 hands the measurement over.
 * 2. `strict` IS NOT ENFORCED by many gateways. Tool arguments are therefore
 *    revalidated by us against `inputSchema`, always (`tools/handlers.ts`).
 * 3. ERRORS ARRIVE INSIDE A 200. A frame carrying `{"error": ...}` becomes a
 *    classified `NarratorError`: there is no path here where a provider
 *    failure turns into narrative text a player would read as the story.
 *
 * Tool arguments come as a STRING, frequently truncated. A call whose string
 * does not parse is not emitted — repairing it would be deciding for the
 * model that decides for the engine (section 0.2).
 */

import {
  NarratorError,
  type NarrateEvent,
  type NarrateFinish,
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

import { errorFromResponse, readSse, wrapUnknown, type NarratorFetch } from '../http.js';
import { extractAndValidate } from '../structured.js';
import { driveStream, type ProviderEvent } from './common.js';

const PROVIDER = 'openai-compatible' as const;

/** Section 0.4: a prudent default, because a gateway rarely says its window. */
export const OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS = 32_000;

/** A provider field is `unknown` until proven otherwise; never stringify one blindly. */
const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

export interface OpenAiCompatibleNarratorOptions {
  readonly fetch: NarratorFetch;
  readonly now?: () => number;
  /**
   * The outcome of the start-up capability probe, when one has been run.
   * Undefined with `NARRATOR_TOOLS=probe` means "not measured yet" and is read
   * as false.
   */
  readonly toolsProbeResult?: boolean;
  /** Some gateways expose a cached-prefix counter; none exposes a cut point. */
  readonly structuredOutput?: boolean;
}

const systemText = (system: readonly NarratorTextBlock[]): string =>
  system.map((block) => block.text).join('\n\n');

function wireMessages(messages: readonly NarratorMessage[]): readonly unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    const texts: string[] = [];
    const toolCalls: unknown[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          texts.push(block.text);
          break;
        case 'tool_use':
          toolCalls.push({
            id: block.callId,
            type: 'function',
            function: { name: block.tool, arguments: JSON.stringify(block.input) },
          });
          break;
        case 'tool_result':
          out.push({ role: 'tool', tool_call_id: block.callId, content: block.content });
          break;
      }
    }
    if (texts.length === 0 && toolCalls.length === 0) continue;
    out.push({
      role: message.role,
      content: texts.join('\n\n'),
      ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
    });
  }
  return out;
}

const wireTools = (tools: readonly NarratorToolSpec[]): readonly unknown[] =>
  tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));

function finishFromReason(reason: unknown): NarrateFinish | null {
  switch (reason) {
    case 'stop':
      return 'complete';
    case 'length':
      return 'truncated';
    case 'tool_calls':
      return 'tool_call';
    case 'content_filter':
      return 'refused';
    default:
      return null;
  }
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

const usageFrom = (raw: WireUsage | undefined): ProviderEvent => ({
  type: 'usage',
  usage: {
    inputTokens: raw?.prompt_tokens ?? 0,
    outputTokens: raw?.completion_tokens ?? 0,
    cacheReadTokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  },
});

export function createOpenAiCompatibleNarrator(
  config: NarratorConfig,
  options: OpenAiCompatibleNarratorOptions,
): NarratorPort {
  if (config.baseUrl === null || config.baseUrl.length === 0) {
    throw new NarratorError({
      code: 'bad_request',
      providerId: PROVIDER,
      message: 'NARRATOR_BASE_URL is required by this provider',
    });
  }
  if (config.apiKey === null || config.apiKey.length === 0) {
    throw new NarratorError({
      code: 'unauthenticated',
      providerId: PROVIDER,
      message: 'NARRATOR_API_KEY is required by this provider',
    });
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const apiKey = config.apiKey;

  const toolsAnnounced =
    config.tools === 'on'
      ? true
      : config.tools === 'off'
        ? false
        : (options.toolsProbeResult ?? false);

  const capabilities: NarratorCapabilities = Object.freeze({
    streaming: true,
    tools: toolsAnnounced,
    structuredOutput: options.structuredOutput ?? true,
    // Some gateways cache the prefix implicitly; none exposes a cut point or a
    // TTL, so `cacheHint` is ignored and the counters read what is offered.
    promptCache: false,
    contextWindowTokens: config.contextWindowTokens ?? OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
    maxCacheBreakpoints: 0,
  });

  const post = async (body: unknown, signal: AbortSignal | undefined): Promise<Response> => {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    };
    let response: Response;
    try {
      response = await options.fetch(`${base}/chat/completions`, init);
    } catch (cause) {
      throw wrapUnknown(cause, PROVIDER);
    }
    if (!response.ok) throw await errorFromResponse(response, PROVIDER);
    return response;
  };

  /** A 200 whose body carries an error object is still an error (section 0.4). */
  const throwIfErrorFrame = (payload: Record<string, unknown>): void => {
    const error = payload['error'];
    if (error === undefined || error === null) return;
    const detail = JSON.stringify(error);
    throw new NarratorError({
      code: /rate|quota|limit/i.test(detail) ? 'rate_limited' : 'unavailable',
      providerId: PROVIDER,
      message: 'provider error frame inside a 200 response',
      providerDetail: detail.slice(0, 2000),
    });
  };

  return {
    providerId: PROVIDER,
    capabilities,

    narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
      const model = config.model ?? '';
      const body = {
        model,
        stream: true,
        max_tokens: req.maxOutputTokens,
        messages: [
          { role: 'system', content: systemText(req.system) },
          ...wireMessages(req.messages),
        ],
        ...(capabilities.tools
          ? {
              tools: wireTools(req.tools),
              tool_choice: req.toolPolicy === 'none' ? 'none' : 'auto',
            }
          : {}),
      };

      return driveStream({
        providerId: PROVIDER,
        requestedModel: model,
        abortSignal: req.abortSignal,
        ...(options.now === undefined ? {} : { now: options.now }),
        frames: async function* frames(): AsyncGenerator<ProviderEvent> {
          const response = await post(body, req.abortSignal);
          const partials = new Map<number, { id: string; name: string; args: string }>();
          for await (const frame of readSse(response)) {
            const payload = frame.data as Record<string, unknown>;
            throwIfErrorFrame(payload);
            const model2 = payload['model'];
            if (typeof model2 === 'string' && model2.length > 0) {
              yield { type: 'model', model: model2 };
            }
            const usage = payload['usage'] as WireUsage | null | undefined;
            if (usage !== undefined && usage !== null) yield usageFrom(usage);

            const choices = payload['choices'] as Record<string, unknown>[] | undefined;
            const choice = choices?.[0];
            if (choice === undefined) continue;
            const delta = choice['delta'] as Record<string, unknown> | undefined;
            const content = delta?.['content'];
            if (typeof content === 'string' && content.length > 0) {
              yield { type: 'delta', text: content };
            }
            const calls = delta?.['tool_calls'] as Record<string, unknown>[] | undefined;
            for (const call of calls ?? []) {
              const index = (call['index'] as number | undefined) ?? 0;
              const fn = call['function'] as Record<string, unknown> | undefined;
              const partial = partials.get(index) ?? { id: '', name: '', args: '' };
              if (typeof call['id'] === 'string') partial.id = call['id'];
              if (typeof fn?.['name'] === 'string') partial.name = fn['name'];
              if (typeof fn?.['arguments'] === 'string') partial.args += fn['arguments'];
              partials.set(index, partial);
            }
            const finish = finishFromReason(choice['finish_reason']);
            if (finish === null) continue;
            if (finish === 'tool_call') {
              for (const [, partial] of [...partials].sort((a, b) => a[0] - b[0])) {
                let parsed: unknown;
                try {
                  parsed = partial.args.length === 0 ? {} : JSON.parse(partial.args);
                } catch {
                  // Truncated or badly escaped: dropped, never repaired.
                  continue;
                }
                yield {
                  type: 'tool_call',
                  call: { type: 'tool_use', callId: partial.id, tool: partial.name, input: parsed },
                };
              }
              partials.clear();
            }
            yield { type: 'finish', finish };
          }
        },
      });
    },

    async structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
      const model = config.modelStructured ?? config.model ?? '';
      const clock = options.now ?? (() => Date.now());
      const startedAt = clock();
      const body = {
        model,
        max_tokens: req.maxOutputTokens,
        messages: [
          { role: 'system', content: systemText(req.system) },
          ...wireMessages(req.messages),
        ],
        ...(capabilities.structuredOutput
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: req.schemaName,
                  schema: z.toJSONSchema(req.schema, { io: 'input' }),
                  strict: true,
                },
              },
            }
          : { response_format: { type: 'json_object' } }),
      };
      const response = await post(body, req.abortSignal);
      let payload: Record<string, unknown>;
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        throw wrapUnknown(cause, PROVIDER);
      }
      throwIfErrorFrame(payload);
      const choices = payload['choices'] as Record<string, unknown>[] | undefined;
      const message = choices?.[0]?.['message'] as Record<string, unknown> | undefined;
      const text = typeof message?.['content'] === 'string' ? message['content'] : '';
      const usage = payload['usage'] as WireUsage | undefined;
      return {
        value: extractAndValidate(req.schema, text, PROVIDER),
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        },
        providerModel: textOr(payload['model'], model),
        latencyMs: clock() - startedAt,
        repairPasses: 0,
      };
    },
  };
}
