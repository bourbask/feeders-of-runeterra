/**
 * THE SIXTEEN CAPABILITY COMBINATIONS — 02-mj-ia.md section 0.2.
 *
 * « On dégrade la prose, jamais l'équité. » Faced with a poor provider the
 * temptation is to hand the model a piece of the decision back. It is
 * forbidden without exception: the turn is ALREADY PLAYED when the storyteller
 * speaks. What is missing is never more than prose.
 *
 * So every one of the sixteen combinations of `streaming`, `tools`,
 * `structuredOutput` and `promptCache` must produce either a conforming
 * narration or the engine fallback, and NEVER an `EngineEffect`, a
 * `character.*` event or a `roll.*` event coming out of the AI layer.
 *
 * ── AND ADR 0011 MAKES ONE COLUMN CONSTANT ──────────────────────────────────
 * `tools` is never sent, on any provider. So the `tools: true` half of the
 * table is no longer « the good case »: it is the case where a capable
 * provider is handed nothing to call anyway. A model that invents a call is
 * answered the same way as one that malforms it — the call is DROPPED, and the
 * request is replayed with `toolPolicy: 'none'`.
 */

import type {
  NarrateEvent,
  NarrateRequest,
  NarrateResult,
  NarratorCapabilities,
  NarratorPort,
  NarratorToolUseBlock,
  StructureResult,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { assertionContext } from '../src/assertions/index.js';
import { buildNarrateRequest } from '../src/context/builder.js';
import { postfilter } from '../src/narration/postfilter.js';
import { runNarration } from '../src/narration/run.js';
import { readNarration } from '../src/outputs/narration.js';
import { CONTEUR_SYSTEM_PROMPT } from '../src/prompts/conteur.system.js';
import { TOOL_DEFINITIONS, TOOL_LOOP_ITERATIONS_MAX } from '../src/tools/definitions.js';
import { CAMPAIGN_BLOCK, RESERVED, VOCABULARY, brief, longCampaign } from './fixtures.js';

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * A scripted port. It answers from a list of turns, records what it was asked,
 * and honours `capabilities.streaming` by splitting the text or not.
 */
function fakePort(
  capabilities: NarratorCapabilities,
  script: readonly { readonly text: string; readonly calls?: readonly NarratorToolUseBlock[] }[],
): NarratorPort & { readonly seen: NarrateRequest[] } {
  const seen: NarrateRequest[] = [];
  let at = 0;
  return {
    providerId: 'stub',
    capabilities,
    seen,
    narrer(request: NarrateRequest): AsyncIterable<NarrateEvent> {
      seen.push(request);
      const step = script[Math.min(at, script.length - 1)] ?? { text: '' };
      at += 1;
      const calls = step.calls ?? [];
      const result: NarrateResult = {
        text: step.text,
        finish: calls.length > 0 ? 'tool_call' : 'complete',
        toolCalls: calls,
        usage: USAGE,
        providerModel: 'faux',
        latencyMs: 1,
      };
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<NarrateEvent> {
          if (capabilities.streaming) {
            for (const piece of step.text.split(' ')) yield { type: 'delta', text: piece };
          } else if (step.text.length > 0) {
            yield { type: 'delta', text: step.text };
          }
          for (const call of calls) yield { type: 'tool_call', call };
          yield { type: 'end', result };
          await Promise.resolve();
        },
      };
    },
    structurer<T>(): Promise<StructureResult<T>> {
      return Promise.reject(new Error('non utilisé ici'));
    },
  };
}

const CAPABILITY_FLAGS = ['streaming', 'tools', 'structuredOutput', 'promptCache'] as const;

/** The sixteen combinations, built rather than written out. */
const COMBINATIONS: readonly NarratorCapabilities[] = Array.from(
  { length: 16 },
  (_unused, mask) => {
    const flags = Object.fromEntries(
      CAPABILITY_FLAGS.map((flag, index) => [flag, (mask & (1 << index)) !== 0]),
    ) as Record<(typeof CAPABILITY_FLAGS)[number], boolean>;
    return {
      ...flags,
      contextWindowTokens: 131_072,
      maxCacheBreakpoints: flags.promptCache ? 4 : 0,
    };
  },
);

const CONFORMING =
  'Tu passes. La corniche cède sous ton pied gauche et ton allié se retourne, la lame basse. ' +
  'La neige s’affaisse en contrebas.';

const request = (): NarrateRequest =>
  buildNarrateRequest({
    requestId: 'nar_deg',
    brief: brief(),
    systemPrompt: CONTEUR_SYSTEM_PROMPT,
    campaignBlock: CAMPAIGN_BLOCK,
    actorLabel: 'Sejuani',
    vocabulary: VOCABULARY,
    trimmable: longCampaign(300),
    contextWindowTokens: 131_072,
  }).request;

const CTX = assertionContext({
  reservedChampions: RESERVED,
  playerCharacterNames: ['Sejuani', 'Braum'],
  absentNames: ['Keld', 'Signy'],
  priceKeywords: ['allié', 'retourne'],
});

describe('les seize combinaisons de capacités', () => {
  it('la table en compte bien seize, toutes distinctes', () => {
    expect(COMBINATIONS).toHaveLength(16);
    expect(
      new Set(
        COMBINATIONS.map((capabilities) =>
          CAPABILITY_FLAGS.map((flag) => (capabilities[flag] ? '1' : '0')).join(''),
        ),
      ).size,
    ).toBe(16);
  });

  /**
   * ── THE SIGNATURE OF THE DOUBLE (RECETTE, mode 8) ─────────────────────────
   * TypeScript accepts a function that takes FEWER parameters than the one it
   * stands in for. A `narrer` double declared with no parameter compiles, and
   * every assertion below about « what was sent » then reads a request the
   * fake never looked at. Measured in this project once already: a `viewerId`
   * a fake ignored made half of ADR 0008 unprovable while 153 tests stayed
   * green. So the double's arity is compared to the port's, out loud.
   */
  it('le double de port reçoit bien ce que le vrai reçoit', () => {
    const port = fakePort(COMBINATIONS[0]!, [{ text: '' }]);
    expect(port.narrer.length).toBe(1);
    const real: NarratorPort['narrer'] = port.narrer.bind(port);
    expect(real.length).toBe(1);
  });

  it('chacune produit soit une narration conforme, soit le repli moteur', async () => {
    const verdicts: { readonly flags: string; readonly decision: string }[] = [];
    for (const capabilities of COMBINATIONS) {
      const port = fakePort(capabilities, [{ text: CONFORMING }]);
      const run = await runNarration(request(), { narrator: port });
      const read = readNarration(run.text, RESERVED);
      verdicts.push({
        flags: CAPABILITY_FLAGS.map((flag) => (capabilities[flag] ? '1' : '0')).join(''),
        decision: postfilter(read.output.prose, CTX).decision,
      });
    }
    expect(verdicts.filter((verdict) => verdict.decision !== 'accept')).toStrictEqual([]);
  });

  /**
   * INVARIANT 1, READ ON THE OUTPUT. Whatever the provider, nothing that comes
   * back out of this layer is an effect, a `character.*` or a `roll.*`. The
   * result is searched for the shapes, not trusted to have none.
   */
  it('et aucune ne fait sortir un EngineEffect, un character.* ni un roll.*', async () => {
    for (const capabilities of COMBINATIONS) {
      const port = fakePort(capabilities, [{ text: CONFORMING }]);
      const run = await runNarration(request(), { narrator: port });
      const read = readNarration(run.text, RESERVED);
      const bytes = JSON.stringify({ run: run.result, output: read.output });
      for (const forbidden of ['character.', 'roll.', 'gauge', 'momentum', 'clock', 'effect']) {
        expect({ forbidden, present: bytes.includes(forbidden) }).toStrictEqual({
          forbidden,
          present: false,
        });
      }
    }
  });

  /**
   * ADR 0011: `tools` is never sent, so the `tools` column no longer changes
   * what leaves this process. Asserted rather than assumed — it is the one
   * column of the table the ADR flattened.
   */
  it('la colonne tools ne change plus rien : aucune requête ne porte d’outil', async () => {
    for (const capabilities of COMBINATIONS) {
      const port = fakePort(capabilities, [{ text: CONFORMING }]);
      await runNarration(request(), { narrator: port });
      expect(
        port.seen.map((sent) => ({ tools: sent.tools.length, policy: sent.toolPolicy })),
      ).toStrictEqual([{ tools: 0, policy: 'none' }]);
    }
  });

  it('et <consignes_du_tour> porte toujours la ligne « n’introduis aucun… »', () => {
    const last = request().messages.at(-1);
    const block = last?.content[0];
    expect(block?.type === 'text' ? block.text : '').toContain(
      "N'introduis aucun personnage, lieu ou fil nouveau dans ce tour.",
    );
  });
});

describe('la boucle d’outils, au-dessus du port', () => {
  const capable: NarratorCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    promptCache: true,
    contextWindowTokens: 131_072,
    maxCacheBreakpoints: 4,
  };

  const badCall: NarratorToolUseBlock = {
    type: 'tool_use',
    callId: 'call_1',
    tool: 'get_state',
    input: { scope: 'inconnu' },
  };

  /**
   * THE CRITERION: a call whose arguments do not validate is DROPPED —
   * `tool_call_dropped`, replay with `toolPolicy: 'none'` — and NEVER repaired
   * into a plausible value. Repairing here would be deciding in the place of
   * the model that decides in the place of the engine.
   */
  it('un tool_call dont les arguments ne valident pas est abandonné, jamais réparé', async () => {
    const logged: { code: string; detail: Record<string, unknown> }[] = [];
    const executed: NarratorToolUseBlock[] = [];
    const port = fakePort(capable, [{ text: '', calls: [badCall] }, { text: CONFORMING }]);
    const run = await runNarration(
      { ...request(), tools: [], toolPolicy: 'none' },
      {
        narrator: port,
        log: (code, detail) => logged.push({ code, detail }),
        executeTool: (call) => {
          executed.push(call);
          return Promise.resolve({ content: '{}', isError: false });
        },
      },
    );
    expect(executed).toStrictEqual([]);
    expect(run.droppedCalls).toStrictEqual([badCall]);
    expect(logged.map((entry) => entry.code)).toStrictEqual(['tool_call_dropped']);
    expect(port.seen.at(-1)?.toolPolicy).toBe('none');
    expect(run.text).toBe(CONFORMING);
  });

  it('et un appel non sollicité, en mode prose seule, est traité pareil', async () => {
    const port = fakePort(capable, [
      { text: '', calls: [{ ...badCall, input: { scope: 'scene' } }] },
      { text: CONFORMING },
    ]);
    const run = await runNarration(request(), { narrator: port });
    expect(run.droppedCalls).toHaveLength(1);
    expect(run.executedCalls).toStrictEqual([]);
    expect(run.text).toBe(CONFORMING);
  });

  /**
   * ── THE HALF NOTHING LOOKED AT ────────────────────────────────────────────
   * Found by reading the coverage report from the lowest file up: `run.ts` sat
   * at 62 %, and the uncovered half was the one where a call is ACTUALLY
   * EXECUTED — the loop's whole reason to exist. Everything above only ever
   * exercised the drop path, which is the path ADR 0011 makes ordinary.
   *
   * `tools` is not sent in M0, so this is exercised by handing the runner a
   * request that does carry them: that is what the day a provider is judged
   * capable enough (M0-31, M0-32) would look like, and it is the shape a
   * regression would hide in.
   */
  it('un appel valide est exécuté, son résultat renvoyé, puis la prose suit', async () => {
    const good: NarratorToolUseBlock = {
      type: 'tool_use',
      callId: 'call_ok',
      tool: 'get_state',
      input: { scope: 'table', character_id: null },
    };
    const port = fakePort(capable, [{ text: '', calls: [good] }, { text: CONFORMING }]);
    const answered: NarratorToolUseBlock[] = [];
    const run = await runNarration(
      { ...request(), tools: TOOL_DEFINITIONS, toolPolicy: 'auto' },
      {
        narrator: port,
        executeTool: (call) => {
          answered.push(call);
          return Promise.resolve({ content: '{"scope":"table"}', isError: false });
        },
      },
    );
    expect(answered).toStrictEqual([good]);
    expect(run.executedCalls).toStrictEqual([good]);
    expect(run.droppedCalls).toStrictEqual([]);
    expect(run.iterations).toBe(2);
    expect(run.text).toBe(CONFORMING);

    // The second request carries the assistant's call and our `tool_result`.
    const second = port.seen[1];
    const blocks = second?.messages.flatMap((message) => message.content) ?? [];
    expect(blocks.filter((block) => block.type === 'tool_use')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'tool_result')).toStrictEqual([
      { type: 'tool_result', callId: 'call_ok', content: '{"scope":"table"}', isError: false },
    ]);
  });

  /**
   * THREE ITERATIONS, THEN THE PROSE. Section 0.1, contract 5. A model that
   * keeps calling is cut off with `toolPolicy: 'none'` rather than looped
   * forever — an unbounded loop here is an unbounded bill and a turn that
   * never ends.
   */
  it('et au-delà de trois itérations, la politique passe à none', async () => {
    const insistent: NarratorToolUseBlock = {
      type: 'tool_use',
      callId: 'call_loop',
      tool: 'get_state',
      input: { scope: 'table', character_id: null },
    };
    const logged: string[] = [];
    const port = fakePort(capable, [{ text: CONFORMING, calls: [insistent] }]);
    const run = await runNarration(
      { ...request(), tools: TOOL_DEFINITIONS, toolPolicy: 'auto' },
      {
        narrator: port,
        log: (code) => logged.push(code),
        executeTool: () => Promise.resolve({ content: '{}', isError: false }),
      },
    );
    expect(run.iterations).toBe(TOOL_LOOP_ITERATIONS_MAX + 1);
    expect(logged).toContain('tool_loop_exhausted');
    expect(port.seen.at(-1)?.toolPolicy).toBe('none');
  });

  it('result.text est bien la concaténation des delta — contrat 2 du §0.1', async () => {
    const port = fakePort(capable, [{ text: CONFORMING }]);
    const seen: string[] = [];
    const run = await runNarration(request(), {
      narrator: port,
      onEvent: (event) => {
        if (event.type === 'delta') seen.push(event.text);
      },
    });
    expect(seen.join(' ')).toBe(run.text);
  });

  it('un flux sans end est un bug d’adaptateur, et se dit', async () => {
    const broken: NarratorPort = {
      providerId: 'stub',
      capabilities: capable,
      narrer: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<NarrateEvent> {
          yield { type: 'delta', text: 'rien' };
          await Promise.resolve();
        },
      }),
      structurer: <T>(): Promise<StructureResult<T>> => Promise.reject(new Error('non')),
    };
    await expect(runNarration(request(), { narrator: broken })).rejects.toThrow(
      'sans événement end',
    );
  });
});

/**
 * THE POST-FILTER, IN BOTH DIRECTIONS. A rule that only ever accepts is a rule
 * that guards nothing, so each of these texts must be refused for the reason
 * named — and the retry policy has to change on the second attempt.
 */
describe('le post-filtre de production', () => {
  it('accepte une narration conforme', () => {
    expect(postfilter(CONFORMING, CTX).decision).toBe('accept');
  });

  it('refuse, relance une fois, puis bascule sur le repli moteur', () => {
    const bad = 'Tu réussis. Ta vigueur baisse de 3 crans. Que fais-tu ?';
    const first = postfilter(bad, CTX, 0);
    expect(first.decision).toBe('retry');
    expect(first.failures.map((failure) => failure.id).sort()).toStrictEqual(
      [
        'no_digits',
        'no_outcome_decision',
        'no_rules_lexicon',
        'no_terminal_prompt',
        'price_respected',
      ].sort(),
    );
    expect(first.corrections).toContain('<corrections>');
    expect(first.corrections).toContain('no_digits');
    expect(postfilter(bad, CTX, 1).decision).toBe('fallback');
  });

  it('signale toujours une fuite de champion réservé, même rattrapable', () => {
    const verdict = postfilter(
      'Tu passes. Lissandra te regarde et ton allié se retourne. La neige tombe.',
      CTX,
    );
    expect(verdict.reservedChampionLeak).toBe(true);
  });

  it('ne consomme que les assertions dures, pas les souples', () => {
    // Three `-ment` adverbs: `adverb_budget` fails, and it is SOFT.
    const soft =
      'Tu passes lentement. Ton allié se retourne doucement et la lame descend calmement. La neige tombe.';
    expect(postfilter(soft, CTX).decision).toBe('accept');
  });
});
