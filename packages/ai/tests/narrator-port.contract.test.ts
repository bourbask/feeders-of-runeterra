/**
 * ONE contract, replayed against the FOUR implementations of the port
 * (02-mj-ia.md section 0.1).
 *
 * The four properties below are what the rest of the system is allowed to
 * assume, whatever is behind the port:
 *
 *   1. exactly ONE `end`, always last — a stream that ends without one is an
 *      adapter bug, not a case to handle downstream;
 *   2. `result.text` IS the ordered concatenation of the deltas — never two
 *      truths about the same text;
 *   3. an error is thrown FROM THE ITERATOR, as a `NarratorError` and nothing
 *      else — no SDK exception, no `fetch` rejection, no parser throw;
 *   4. an abort still ends, with `finish: 'aborted'` AND the partial text —
 *      section 6.4 persists that text, so losing it loses a player's scene.
 *
 * Writing this once per adapter is how two of the four end up subtly
 * different. It is written once, and `it.each` does the rest.
 */

import {
  NarratorError,
  TOOL_INPUT_SCHEMAS,
  type NarrateEvent,
  type NarrateResult,
  type NarratorPort,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAnthropicNarrator } from '../src/narrator/adapters/anthropic.js';
import { createOllamaNarrator } from '../src/narrator/adapters/ollama.js';
import { createOpenAiCompatibleNarrator } from '../src/narrator/adapters/openai-compatible.js';
import { createStubNarrator } from '../src/narrator/adapters/stub.js';
import { selectNarrator } from '../src/narrator/select.js';
import { firstBalancedObject } from '../src/narrator/structured.js';
import { TOOL_DEFINITIONS, TOOL_DEFINITIONS_BY_NAME } from '../src/tools/definitions.js';
import { collect, configFor, ndjson, scriptedFetch, sse, streamResponse } from './support.js';

const request = (over: Record<string, unknown> = {}) => ({
  purpose: 'narration' as const,
  requestId: 'nar_01',
  system: [{ type: 'text' as const, text: 'système', cacheHint: 'stable' as const }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'tour' }] }],
  tools: TOOL_DEFINITIONS,
  toolPolicy: 'auto' as const,
  maxOutputTokens: 800,
  effort: 'low' as const,
  ...over,
});

/** The same three deltas, spelled in each wire format. */
const PIECES = ['Tu passes', '. La corde tient', '. Rien ne suit.'];
const WHOLE = PIECES.join('');

interface Case {
  readonly name: string;
  /** A port that will stream `PIECES` then end. Handed the request's signal. */
  build(signal?: AbortSignal): NarratorPort;
  /** A port whose transport answers with `status`. */
  failing?(status: number, headers?: Record<string, string>): NarratorPort;
}

const CASES: readonly Case[] = [
  {
    name: 'stub',
    build: () => createStubNarrator(configFor('stub'), { texts: [WHOLE], chunks: 3 }),
  },
  {
    name: 'anthropic',
    build: (signal) =>
      createAnthropicNarrator(configFor('anthropic'), {
        fetch: scriptedFetch(() =>
          streamResponse(
            sse([
              { type: 'message_start', message: { model: 'wire-model', usage: {} } },
              ...PIECES.map((text) => ({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text },
              })),
              {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { input_tokens: 11, output_tokens: 7 },
              },
            ]),
            signal === undefined ? {} : { signal },
          ),
        ),
      }),
    failing: (status, headers) =>
      createAnthropicNarrator(configFor('anthropic'), {
        fetch: scriptedFetch(
          () =>
            new Response('{"error":"x"}', {
              status,
              ...(headers === undefined ? {} : { headers }),
            }),
        ),
      }),
  },
  {
    name: 'openai-compatible',
    build: (signal) =>
      createOpenAiCompatibleNarrator(configFor('openai-compatible'), {
        fetch: scriptedFetch(() =>
          streamResponse(
            sse([
              ...PIECES.map((text) => ({
                model: 'wire-model',
                choices: [{ index: 0, delta: { content: text } }],
              })),
              { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: {} },
            ]),
            signal === undefined ? {} : { signal },
          ),
        ),
      }),
    failing: (status, headers) =>
      createOpenAiCompatibleNarrator(configFor('openai-compatible'), {
        fetch: scriptedFetch(
          () =>
            new Response('{"error":"x"}', {
              status,
              ...(headers === undefined ? {} : { headers }),
            }),
        ),
      }),
  },
  {
    name: 'ollama',
    build: (signal) =>
      createOllamaNarrator(configFor('ollama'), {
        fetch: scriptedFetch(() =>
          streamResponse(
            ndjson([
              ...PIECES.map((text) => ({ model: 'wire-model', message: { content: text } })),
              { done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 },
            ]),
            signal === undefined ? {} : { signal },
          ),
        ),
      }),
    failing: (status, headers) =>
      createOllamaNarrator(configFor('ollama'), {
        fetch: scriptedFetch(
          () =>
            new Response('{"error":"x"}', {
              status,
              ...(headers === undefined ? {} : { headers }),
            }),
        ),
      }),
  },
];

describe.each(CASES)('le contrat du port, adaptateur $name', (testCase) => {
  it('émet exactement un end, et il est le dernier', async () => {
    const events = await collect(testCase.build().narrer(request()));
    const ends = events.filter((event) => event.type === 'end');
    expect(ends).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('end');
  });

  it('rend un texte égal à la concaténation ordonnée des delta', async () => {
    const events = await collect(testCase.build().narrer(request()));
    const deltas = events.filter((event) => event.type === 'delta').map((event) => event.text);
    const end = events.at(-1);
    expect(end?.type).toBe('end');
    expect(deltas.length).toBeGreaterThan(1);
    expect(end?.type === 'end' ? end.result.text : '').toBe(deltas.join(''));
    expect(deltas.join('')).toBe(WHOLE);
  });

  it('annonce son identifiant de fournisseur et ses capacités', () => {
    const port = testCase.build();
    expect(port.providerId).toBe(testCase.name);
    expect(typeof port.capabilities.contextWindowTokens).toBe('number');
    expect(port.capabilities.contextWindowTokens).toBeGreaterThan(0);
  });

  it('interrompu, rend un end aborted QUI PORTE le texte partiel', async () => {
    const controller = new AbortController();
    const port = testCase.build(controller.signal);
    const events: string[] = [];
    let ended: { finish: string; text: string } | null = null;
    for await (const event of port.narrer(request({ abortSignal: controller.signal }))) {
      if (event.type === 'delta') {
        events.push(event.text);
        if (events.length === 1) controller.abort();
      }
      if (event.type === 'end') ended = { finish: event.result.finish, text: event.result.text };
    }
    expect(ended).not.toBeNull();
    expect(ended?.finish).toBe('aborted');
    expect(ended?.text).toBe(events.join(''));
    expect(ended?.text.length).toBeGreaterThan(0);
  });
});

describe.each(CASES.filter((testCase) => testCase.failing !== undefined))(
  'ce qui sort de l’itérateur, adaptateur $name',
  (testCase) => {
    it('est un NarratorError et rien d’autre', async () => {
      const port = testCase.failing!(500);
      await expect(collect(port.narrer(request()))).rejects.toBeInstanceOf(NarratorError);
    });
  },
);

describe('le stub, qui est le seul à n’ouvrir aucune socket', () => {
  /**
   * THE CLOCK IS INJECTED, AND THAT IS THE WHOLE POINT OF THIS TEST.
   *
   * This is the test that proves invariant 4 on the stub — same turn replayed,
   * same text. Written without `now`, it compared the WHOLE serialised stream,
   * and that stream carries `result.latencyMs`, which `driveStream` reads from
   * `Date.now()`. Measured over 3 000 identical calls: 0 ms 2 977 times, 1 ms
   * 21 times, 2 ms twice. So the one field that is non-deterministic BY
   * CONSTRUCTION was deciding the verdict of the determinism test — a flake of
   * about one and a half per cent in job 6, on pull requests that changed
   * nothing. `StubNarratorOptions.now` existed and was simply not passed.
   */
  it('rend le même texte pour le même requestId', async () => {
    const port = createStubNarrator(configFor('stub'), {
      texts: ['un', 'deux', 'trois'],
      now: () => 0,
    });
    const first = await collect(port.narrer(request({ requestId: 'nar_42' })));
    const second = await collect(port.narrer(request({ requestId: 'nar_42' })));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  /**
   * And the other half: what is deterministic is the TEXT, not the latency.
   * With a clock that advances, the two runs still carry the same deltas and
   * the same `result.text` while `latencyMs` differs — which is the measured
   * reason the assertion above may not read it.
   */
  it('et c’est le texte qui est déterministe, pas la latence', async () => {
    // `driveStream` reads the clock twice per call, start then end. Two runs,
    // two durations: 1 ms, then 5 ms — the spread the 3 000-call measurement saw.
    const stamps = [0, 1, 0, 5];
    let at = 0;
    const port = createStubNarrator(configFor('stub'), {
      texts: ['un', 'deux', 'trois'],
      now: () => stamps[at++] ?? 0,
    });
    const first = await collect(port.narrer(request({ requestId: 'nar_42' })));
    const second = await collect(port.narrer(request({ requestId: 'nar_42' })));
    const textsOf = (events: NarrateEvent[]): readonly string[] =>
      events.filter((event) => event.type === 'delta').map((event) => event.text);
    const endOf = (events: NarrateEvent[]): NarrateResult => {
      const end = events.at(-1);
      if (end?.type !== 'end') throw new Error('pas de end');
      return end.result;
    };
    expect(textsOf(first)).toStrictEqual(textsOf(second));
    expect(endOf(first).text).toBe(endOf(second).text);
    expect(endOf(first).latencyMs).toBe(1);
    expect(endOf(second).latencyMs).toBe(5);
  });

  it('annonce toutes ses capacités à faux sauf le flux (§0.6)', () => {
    const { capabilities } = createStubNarrator(configFor('stub'));
    expect(capabilities.streaming).toBe(true);
    expect(capabilities.tools).toBe(false);
    expect(capabilities.structuredOutput).toBe(false);
    expect(capabilities.promptCache).toBe(false);
    expect(capabilities.maxCacheBreakpoints).toBe(0);
  });
});

/**
 * The selector, section 0.6.
 *
 * It is the only file of `@for/ai` besides `adapters/` allowed to name the
 * four implementations, and its job is exactly one decision. What is asserted
 * is the decision, and that a missing required field STOPS rather than
 * producing a port that will fail on the first turn of a real game.
 */
describe('selectNarrator', () => {
  const fetchImpl = scriptedFetch(() => new Response('{}', { status: 200 }));

  it('rend une implémentation par identifiant de fournisseur', () => {
    for (const provider of ['stub', 'anthropic', 'openai-compatible', 'ollama'] as const) {
      expect(selectNarrator(configFor(provider), { fetch: fetchImpl }).providerId).toBe(provider);
    }
  });

  it('arrête sur une clé absente là où elle est obligatoire', () => {
    expect(() =>
      selectNarrator(configFor('anthropic', { apiKey: null }), { fetch: fetchImpl }),
    ).toThrow(NarratorError);
    expect(() =>
      selectNarrator(configFor('openai-compatible', { baseUrl: null }), { fetch: fetchImpl }),
    ).toThrow(NarratorError);
    expect(() =>
      selectNarrator(configFor('ollama', { baseUrl: null }), { fetch: fetchImpl }),
    ).toThrow(NarratorError);
  });

  it('ignore la clé pour ollama, seule exception de la §0.6', () => {
    expect(
      selectNarrator(configFor('ollama', { apiKey: null }), { fetch: fetchImpl }),
    ).toBeDefined();
  });

  it('n’a besoin d’aucun transport pour le stub', () => {
    expect(selectNarrator(configFor('stub')).providerId).toBe('stub');
  });

  /**
   * `ambientFetch`, the branch nothing exercised — measured at 53,84 % of
   * branches and 50 % of functions on this file before this test. With no
   * transport handed in, a networked adapter takes the ambient `fetch`; where
   * there is none, the port REFUSES at selection time rather than handing back
   * a port that throws a `TypeError` on the first turn of a real game. The
   * stub is the exception by definition: it opens nothing, ever.
   */
  it('refuse un fournisseur en réseau quand il n’y a pas de fetch ambiant', () => {
    const ambient = globalThis.fetch;
    try {
      (globalThis as { fetch?: unknown }).fetch = undefined;
      const refusals = (['anthropic', 'openai-compatible', 'ollama'] as const).map((provider) => {
        try {
          selectNarrator(configFor(provider));
          return { provider, code: 'aucune erreur' };
        } catch (cause) {
          return {
            provider,
            code: cause instanceof NarratorError ? cause.code : 'pas un NarratorError',
          };
        }
      });
      expect(refusals).toStrictEqual([
        { provider: 'anthropic', code: 'unsupported' },
        { provider: 'openai-compatible', code: 'unsupported' },
        { provider: 'ollama', code: 'unsupported' },
      ]);
      expect(selectNarrator(configFor('stub')).providerId).toBe('stub');
    } finally {
      globalThis.fetch = ambient;
    }
  });

  /** The other direction: with an ambient `fetch` present, the three are built. */
  it('et le prend quand il existe, sans jamais l’appeler ici', () => {
    expect(typeof globalThis.fetch).toBe('function');
    for (const provider of ['anthropic', 'openai-compatible', 'ollama'] as const) {
      expect(selectNarrator(configFor(provider)).providerId).toBe(provider);
    }
  });

  /**
   * Section 0.6's per-adapter column, and the one place the default is NOT
   * what the variable says. With `probe`, this adapter announces `tools:
   * false` until something MEASURES otherwise: the probe is a network call,
   * it never runs in CI, and a capability announced true without measurement
   * is the failure the probe exists to prevent.
   */
  it('n’annonce les outils que lorsqu’ils sont mesurés ou forcés', () => {
    const probe = (over: Record<string, unknown>, deps = {}) =>
      selectNarrator(configFor('openai-compatible', over), { fetch: fetchImpl, ...deps })
        .capabilities.tools;
    expect(probe({ tools: 'probe' })).toBe(false);
    expect(probe({ tools: 'probe' }, { toolsProbeResult: true })).toBe(true);
    expect(probe({ tools: 'on' })).toBe(true);
    expect(probe({ tools: 'off' })).toBe(false);
    expect(selectNarrator(configFor('ollama'), { fetch: fetchImpl }).capabilities.tools).toBe(
      false,
    );
    expect(selectNarrator(configFor('anthropic'), { fetch: fetchImpl }).capabilities.tools).toBe(
      true,
    );
  });
});

/**
 * `structurer()` NEVER returns an unvalidated value — the signature is the
 * guarantee (section 0.2). Two different failures take the same road on
 * purpose: JSON that does not parse, and JSON that parses and does not match.
 */
describe('structurer, sur les trois adaptateurs en réseau', () => {
  const schema = z.object({ titre: z.string(), ouvert: z.boolean() });
  const good = JSON.stringify({ titre: 'La tempête', ouvert: true });

  const build = (name: string, body: string): NarratorPort => {
    const answer = scriptedFetch(() => new Response(body, { status: 200 }));
    if (name === 'anthropic') {
      return createAnthropicNarrator(configFor('anthropic'), { fetch: answer });
    }
    if (name === 'ollama') return createOllamaNarrator(configFor('ollama'), { fetch: answer });
    return createOpenAiCompatibleNarrator(configFor('openai-compatible'), { fetch: answer });
  };

  const envelope = (name: string, text: string): string =>
    name === 'anthropic'
      ? JSON.stringify({ model: 'wire', content: [{ type: 'text', text }], usage: {} })
      : name === 'ollama'
        ? JSON.stringify({ model: 'wire', message: { content: text } })
        : JSON.stringify({ model: 'wire', choices: [{ message: { content: text } }], usage: {} });

  const request = (over: Record<string, unknown> = {}) => ({
    purpose: 'chronicle' as const,
    requestId: 'str_1',
    system: [{ type: 'text' as const, text: 'archiviste' }],
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'compacte' }] }],
    schema,
    schemaName: 'chronique',
    maxOutputTokens: 800,
    effort: 'high' as const,
    ...over,
  });

  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'rend une valeur déjà validée — %s',
    async (name) => {
      const result = await build(name, envelope(name, `voici : ${good}`)).structurer(request());
      expect(result.value).toStrictEqual({ titre: 'La tempête', ouvert: true });
      expect(result.repairPasses).toBe(0);
      expect(result.providerModel).toBe('wire');
    },
  );

  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'refuse en invalid_output une sortie hors schéma — %s',
    async (name) => {
      await expect(
        build(name, envelope(name, '{"titre": 3}')).structurer(request()),
      ).rejects.toMatchObject({ code: 'invalid_output' });
    },
  );

  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'refuse en invalid_output une réponse sans objet JSON — %s',
    async (name) => {
      await expect(
        build(name, envelope(name, 'je préfère ne pas')).structurer(request()),
      ).rejects.toMatchObject({ code: 'invalid_output' });
    },
  );
});

/**
 * A TOOL CALL, FROM THE WIRE TO THE FROZEN SURFACE.
 *
 * ── WHY THIS WAS MISSING, AND WHY IT MATTERS ────────────────────────────────
 * `tests/tool-surface.test.ts` freezes the twelve tools and pins which side of
 * the read / proposal frontier each one lands on, but it starts from a
 * `NarratorToolUseBlock` already built by hand. NOTHING exercised the step
 * before that: turning a provider's wire frames into that block. Measured on
 * the coverage report of this package — the whole `case 'tool_call'` of
 * `driveStream` (`common.ts` 91-94), the `content_block_start` /
 * `input_json_delta` / `content_block_stop` path of `anthropic.ts` (277-320),
 * the `tool_calls` accumulation of `openai-compatible.ts` (259-286) and the
 * `tool_calls` loop of `ollama.ts` (175-188) were all at zero.
 *
 * That is the first half of invariant 1 on this side of the port: a tool call
 * the adapter mis-decodes is a call the handler never gets to route.
 *
 * ── WHAT IT FOUND ───────────────────────────────────────────────────────────
 * `ollama` read "has there been a tool call" from the CURRENT ndjson line,
 * while this server puts `tool_calls` on a message line and `done` on a later
 * one, `done_reason: 'stop'` either way. So the stream ended `complete`, and
 * `driveStream` keeps `result.toolCalls` only when the finish IS `tool_call` —
 * the call reached the caller as an event and as an empty list at the same
 * time, which is exactly the "never two truths about the same thing" the four
 * properties above exist to forbid. Fixed in the adapter, pinned here.
 */
describe('un appel d’outil décodé depuis le fil', () => {
  /** One `roll_oracle` call, valid against the frozen input schema. */
  const ORACLE_INPUT = {
    table_id: 'yes-no',
    question: 'La corde tient-elle ?',
    likelihood: 'incertain',
  };
  const ARGS = JSON.stringify(ORACLE_INPUT);
  /** Split in two, because every provider streams tool arguments in pieces. */
  const CUT = 18;

  /** The call id each adapter is expected to produce — `ollama` sends none. */
  const EXPECTED_CALL_ID: Record<string, string> = {
    anthropic: 'toolu_1',
    'openai-compatible': 'call_1',
    ollama: 'roll_oracle',
  };

  const toolPort = (name: string, args: string): NarratorPort => {
    if (name === 'anthropic') {
      return createAnthropicNarrator(configFor('anthropic'), {
        fetch: scriptedFetch(() =>
          streamResponse(
            sse([
              { type: 'message_start', message: { model: 'wire-model', usage: {} } },
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'toolu_1', name: 'roll_oracle' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: args.slice(0, CUT) },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: args.slice(CUT) },
              },
              { type: 'content_block_stop', index: 0 },
              {
                type: 'message_delta',
                delta: { stop_reason: 'tool_use' },
                usage: { input_tokens: 11, output_tokens: 7 },
              },
            ]),
          ),
        ),
      });
    }
    if (name === 'ollama') {
      // This one hands arguments over as an object, so there is nothing to cut.
      return createOllamaNarrator(configFor('ollama', { tools: 'on' }), {
        fetch: scriptedFetch(() =>
          streamResponse(
            ndjson([
              {
                model: 'wire-model',
                message: {
                  content: '',
                  tool_calls: [
                    { function: { name: 'roll_oracle', arguments: JSON.parse(args) as unknown } },
                  ],
                },
              },
              { done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 },
            ]),
          ),
        ),
      });
    }
    return createOpenAiCompatibleNarrator(configFor('openai-compatible', { tools: 'on' }), {
      fetch: scriptedFetch(() =>
        streamResponse(
          sse([
            {
              model: 'wire-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: { name: 'roll_oracle', arguments: args.slice(0, CUT) },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(CUT) } }] },
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: {} },
          ]),
        ),
      ),
    });
  };

  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'rend le bloc exact que le registre attend — %s',
    async (name) => {
      const events = await collect(toolPort(name, ARGS).narrer(request()));
      const calls = events.filter((event) => event.type === 'tool_call').map((event) => event.call);
      expect(calls).toStrictEqual([
        {
          type: 'tool_use',
          callId: EXPECTED_CALL_ID[name],
          tool: 'roll_oracle',
          input: ORACLE_INPUT,
        },
      ]);
    },
  );

  /**
   * The event stream and `result.toolCalls` are ONE truth, not two — and the
   * finish is what tells the caller to run the loop of section 3.1.
   */
  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'annonce tool_call et reporte les mêmes appels dans le résultat — %s',
    async (name) => {
      const events = await collect(toolPort(name, ARGS).narrer(request()));
      const calls = events.filter((event) => event.type === 'tool_call').map((event) => event.call);
      const end = events.at(-1);
      expect(end?.type).toBe('end');
      if (end?.type !== 'end') return;
      expect(end.result.finish).toBe('tool_call');
      expect(end.result.toolCalls).toStrictEqual(calls);
    },
  );

  /**
   * And what comes off the wire is accepted by the FROZEN surface: the name is
   * one of the twelve, and the decoded arguments validate against the very
   * schema `runToolCall` revalidates with. A decode that drifted would produce
   * a call the handler drops as `invalid_arguments`, silently.
   */
  it.each(['anthropic', 'openai-compatible', 'ollama'])(
    'et ce qu’il décode est recevable par la surface gelée — %s',
    async (name) => {
      const events = await collect(toolPort(name, ARGS).narrer(request()));
      const call = events.find((event) => event.type === 'tool_call');
      expect(call?.type).toBe('tool_call');
      if (call?.type !== 'tool_call') return;
      expect(Object.hasOwn(TOOL_DEFINITIONS_BY_NAME, call.call.tool)).toBe(true);
      expect(TOOL_INPUT_SCHEMAS.roll_oracle.safeParse(call.call.input).success).toBe(true);
    },
  );

  /**
   * Section 0.2: a tool call whose arguments do not parse is DROPPED, never
   * repaired into something plausible. The two adapters that receive arguments
   * as a string are the two that can see a truncation.
   */
  it.each(['anthropic', 'openai-compatible'])(
    'abandonne un appel aux arguments tronqués, sans rien inventer — %s',
    async (name) => {
      const events = await collect(toolPort(name, ARGS.slice(0, -4)).narrer(request()));
      expect(events.filter((event) => event.type === 'tool_call')).toStrictEqual([]);
      const end = events.at(-1);
      expect(end?.type).toBe('end');
      if (end?.type !== 'end') return;
      expect(end.result.toolCalls).toStrictEqual([]);
    },
  );
});

describe('l’extraction du premier objet équilibré', () => {
  it('ignore ce qui précède, ce qui suit, et les accolades entre guillemets', () => {
    expect(firstBalancedObject('bla {"a":{"b":"}"},"c":1} queue')).toBe('{"a":{"b":"}"},"c":1}');
  });

  it('rend null quand il n’y a pas d’objet complet', () => {
    expect(firstBalancedObject('pas d’objet')).toBeNull();
    expect(firstBalancedObject('{"a": 1')).toBeNull();
  });
});
