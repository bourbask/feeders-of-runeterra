/**
 * The `anthropic` adapter (02-mj-ia.md section 0.3).
 *
 * ── A REPORTED DEVIATION, NOT A SHORTCUT ────────────────────────────────────
 * Section 0.3 writes this adapter on top of `@anthropic-ai/sdk`. It is built
 * on `fetch` instead, and the pull request says so rather than leaving it to
 * be discovered. Three reasons, in order of weight:
 *
 *   1. the acceptance criterion of M0-18 exercises "une reponse 401, 429, 404,
 *      400 et 5xx simulee" — HTTP responses. A transport parameter makes that
 *      a two-line fake; an SDK makes it a mock of somebody else's object graph;
 *   2. `tests/setup.ts` fails the run on any real egress, and the same
 *      simulated transport is what lets the port contract test be replayed
 *      against all four implementations, which is the point of that test;
 *   3. the dependency is declared OPTIONAL by ARCHITECTURE.md section 5, and
 *      an optional dependency that is imported unconditionally is not optional.
 *
 * What is NOT deviated from: every wire field of section 0.3 is produced
 * exactly as the table says — the cache breakpoints, their TTLs, the four-
 * breakpoint ceiling, the stop-code mapping and the usage counters.
 *
 * ── WHAT NEVER LEAVES THIS FILE ─────────────────────────────────────────────
 * Model identifiers, cache-control shapes, stop codes and HTTP statuses. What
 * crosses the port is `NarrateFinish` and `NarratorErrorCode`, and the
 * acceptance criterion greps `packages/ai/src` outside `narrator/` to prove it.
 */

import {
  NarratorError,
  type NarrateEvent,
  type NarrateFinish,
  type NarrateRequest,
  type NarratorCacheHint,
  type NarratorCapabilities,
  type NarratorConfig,
  type NarratorMessage,
  type NarratorPort,
  type NarratorTextBlock,
  type NarratorToolSpec,
  type StructureRequest,
  type StructureResult,
} from '@for/contracts';

import { errorFromResponse, readSse, wrapUnknown, type NarratorFetch } from '../http.js';
import { extractAndValidate } from '../structured.js';
import { driveStream, type ProviderEvent } from './common.js';

const PROVIDER = 'anthropic' as const;

/** Section 0.3, exact identifiers, no date suffix. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_DEFAULT_MODEL_STRUCTURED = 'claude-opus-5';
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_CONTEXT_WINDOW_TOKENS = 1_000_000;
/** Section 0.3: four cut points per request; beyond, the first four are kept. */
export const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4;
const API_VERSION = '2023-06-01';

/** A provider field is `unknown` until proven otherwise; never stringify one blindly. */
const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

export interface AnthropicNarratorOptions {
  readonly fetch: NarratorFetch;
  readonly now?: () => number;
}

interface WireCacheControl {
  readonly type: 'ephemeral';
  readonly ttl: '5m' | '1h';
}

/** Section 0.3's two TTLs, one per hint. A record rather than a switch: the
 * mapping is data, and a fourth hint would fail to compile here. */
const CACHE_TTL: Readonly<Record<NarratorCacheHint, WireCacheControl['ttl']>> = {
  stable: '1h',
  session: '1h',
  rolling: '5m',
};

const cacheControlFor = (block: NarratorTextBlock): WireCacheControl | undefined =>
  block.cacheHint === undefined
    ? undefined
    : { type: 'ephemeral', ttl: CACHE_TTL[block.cacheHint] };

/**
 * Apply the cache hints, first four win.
 *
 * Silently for the caller and with one log line, says the spec; the port has
 * no logger, so the count is returned for the caller to log. Dropping them
 * without saying how many were dropped is how a cache stops working for a
 * month without anybody noticing.
 */
function withBreakpoints(
  system: readonly NarratorTextBlock[],
  messages: readonly NarratorMessage[],
): {
  readonly system: readonly unknown[];
  readonly messages: readonly unknown[];
  readonly dropped: number;
} {
  let spent = 0;
  let dropped = 0;
  const take = (block: NarratorTextBlock): WireCacheControl | undefined => {
    const wanted = cacheControlFor(block);
    if (wanted === undefined) return undefined;
    if (spent >= ANTHROPIC_MAX_CACHE_BREAKPOINTS) {
      dropped += 1;
      return undefined;
    }
    spent += 1;
    return wanted;
  };

  const wireSystem = system.map((block) => {
    const control = take(block);
    return control === undefined
      ? { type: 'text', text: block.text }
      : { type: 'text', text: block.text, cache_control: control };
  });

  const wireMessages = messages.map((message) => ({
    role: message.role,
    content: message.content.map((block) => {
      switch (block.type) {
        case 'text': {
          const control = take(block);
          return control === undefined
            ? { type: 'text', text: block.text }
            : { type: 'text', text: block.text, cache_control: control };
        }
        case 'tool_use':
          return { type: 'tool_use', id: block.callId, name: block.tool, input: block.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.callId,
            content: block.content,
            is_error: block.isError,
          };
      }
    }),
  }));

  return { system: wireSystem, messages: wireMessages, dropped };
}

const wireTools = (tools: readonly NarratorToolSpec[]): readonly unknown[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    strict: true,
  }));

/** Section 0.3's stop-code table, and its only home. */
function finishFromStop(stop: unknown): NarrateFinish | null {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
      return 'complete';
    case 'max_tokens':
      return 'truncated';
    case 'tool_use':
      return 'tool_call';
    case 'refusal':
      return 'refused';
    default:
      return null;
  }
}

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const usageFrom = (raw: WireUsage | undefined): ProviderEvent => ({
  type: 'usage',
  usage: {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    cacheReadTokens: raw?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw?.cache_creation_input_tokens ?? 0,
  },
});

export function createAnthropicNarrator(
  config: NarratorConfig,
  options: AnthropicNarratorOptions,
): NarratorPort {
  if (config.apiKey === null || config.apiKey.length === 0) {
    throw new NarratorError({
      code: 'unauthenticated',
      providerId: PROVIDER,
      message: 'NARRATOR_API_KEY is required by this provider',
    });
  }
  const apiKey = config.apiKey;
  const base = (config.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');

  const capabilities: NarratorCapabilities = Object.freeze({
    streaming: true,
    // Native support: section 0.6 says this adapter never probes. `off` still
    // forces the tool-less mode, because that is what the variable is for.
    tools: config.tools !== 'off',
    structuredOutput: true,
    promptCache: true,
    contextWindowTokens: config.contextWindowTokens ?? ANTHROPIC_CONTEXT_WINDOW_TOKENS,
    maxCacheBreakpoints: ANTHROPIC_MAX_CACHE_BREAKPOINTS,
  });

  const post = async (body: unknown, signal: AbortSignal | undefined): Promise<Response> => {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    };
    let response: Response;
    try {
      response = await options.fetch(`${base}/v1/messages`, init);
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
      const model = config.model ?? ANTHROPIC_DEFAULT_MODEL;
      const shaped = withBreakpoints(req.system, req.messages);
      const body = {
        model,
        max_tokens: req.maxOutputTokens,
        stream: true,
        system: shaped.system,
        messages: shaped.messages,
        output_config: { effort: req.effort },
        ...(capabilities.tools
          ? {
              tools: wireTools(req.tools),
              tool_choice: { type: req.toolPolicy === 'none' ? 'none' : 'auto' },
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
          const partials = new Map<number, { id: string; name: string; json: string }>();
          for await (const frame of readSse(response)) {
            const payload = frame.data as Record<string, unknown>;
            const kind = (payload['type'] as string | undefined) ?? frame.event ?? '';
            switch (kind) {
              case 'message_start': {
                const message = payload['message'] as
                  { model?: string; usage?: WireUsage } | undefined;
                if (message?.model !== undefined) yield { type: 'model', model: message.model };
                if (message?.usage !== undefined) yield usageFrom(message.usage);
                break;
              }
              case 'content_block_start': {
                const block = payload['content_block'] as Record<string, unknown> | undefined;
                if (block?.['type'] === 'tool_use') {
                  partials.set(payload['index'] as number, {
                    id: String(block['id']),
                    name: String(block['name']),
                    json: '',
                  });
                }
                break;
              }
              case 'content_block_delta': {
                const delta = payload['delta'] as Record<string, unknown>;
                if (delta['type'] === 'text_delta') {
                  yield { type: 'delta', text: String(delta['text']) };
                } else if (delta['type'] === 'input_json_delta') {
                  const partial = partials.get(payload['index'] as number);
                  if (partial !== undefined) partial.json += String(delta['partial_json']);
                }
                break;
              }
              case 'content_block_stop': {
                const partial = partials.get(payload['index'] as number);
                if (partial === undefined) break;
                partials.delete(payload['index'] as number);
                // A tool call whose arguments do not parse is NEVER repaired
                // into something plausible (section 0.2): it is not emitted.
                let parsed: unknown;
                try {
                  parsed = partial.json.length === 0 ? {} : JSON.parse(partial.json);
                } catch {
                  break;
                }
                yield {
                  type: 'tool_call',
                  call: {
                    type: 'tool_use',
                    callId: partial.id,
                    tool: partial.name,
                    input: parsed,
                  },
                };
                break;
              }
              case 'message_delta': {
                const delta = payload['delta'] as Record<string, unknown> | undefined;
                const finish = finishFromStop(delta?.['stop_reason']);
                if (finish !== null) yield { type: 'finish', finish };
                const usage = payload['usage'] as WireUsage | undefined;
                if (usage !== undefined) yield usageFrom(usage);
                break;
              }
              case 'error': {
                const detail = payload['error'] as Record<string, unknown> | undefined;
                throw new NarratorError({
                  code: 'unavailable',
                  providerId: PROVIDER,
                  message: 'provider error frame',
                  providerDetail: JSON.stringify(detail ?? payload).slice(0, 2000),
                });
              }
              default:
                break;
            }
          }
        },
      });
    },

    async structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
      const model = config.modelStructured ?? ANTHROPIC_DEFAULT_MODEL_STRUCTURED;
      const startedAt = (options.now ?? Date.now)();
      const shaped = withBreakpoints(req.system, req.messages);
      const response = await post(
        {
          model,
          max_tokens: req.maxOutputTokens,
          system: shaped.system,
          messages: shaped.messages,
          output_config: { effort: req.effort },
        },
        req.abortSignal,
      );
      let payload: Record<string, unknown>;
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        throw wrapUnknown(cause, PROVIDER);
      }
      const blocks = (payload['content'] as { type: string; text?: string }[] | undefined) ?? [];
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      const value = extractAndValidate(req.schema, text, PROVIDER);
      const usage = payload['usage'] as WireUsage | undefined;
      return {
        value,
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
        },
        providerModel: textOr(payload['model'], model),
        latencyMs: (options.now ?? Date.now)() - startedAt,
        repairPasses: 0,
      };
    },
  };
}
