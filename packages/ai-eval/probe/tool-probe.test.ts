import { NarratorError } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { PROBE_TOOL, probeTools } from './tool-probe.js';

import type {
  NarrateEvent,
  NarrateRequest,
  NarratorCapabilities,
  NarratorPort,
} from '@for/contracts';

const capabilities = (over: Partial<NarratorCapabilities> = {}): NarratorCapabilities => ({
  streaming: true,
  tools: true,
  structuredOutput: true,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
  ...over,
});

/**
 * A port whose `narrer` takes the SAME single parameter the real one takes,
 * and whose `structurer` is the real signature too. A double declared with one
 * parameter fewer compiles without a word — mode 8 of `docs/RECETTE.md`.
 */
const port = (
  over: Partial<NarratorPort> & { readonly seen?: NarrateRequest[] } = {},
): NarratorPort => ({
  providerId: 'ollama',
  capabilities: capabilities(),
  narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
    over.seen?.push(req);
    return (async function* stream(): AsyncGenerator<NarrateEvent> {
      await Promise.resolve();
      yield {
        type: 'end',
        result: {
          text: 'du texte',
          finish: 'complete',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          providerModel: 'modele-x',
          latencyMs: 1,
        },
      };
    })();
  },
  structurer: () => Promise.reject(new Error('pas utilisé ici')),
  ...over,
});

describe('la sonde d’outils', () => {
  it('n’ouvre rien sur le stub', async () => {
    const seen: NarrateRequest[] = [];
    const outcome = await probeTools(port({ providerId: 'stub', seen }));
    expect(outcome.ran).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('n’ouvre rien quand l’adaptateur n’émet pas la table, et dit laquelle poser', async () => {
    const seen: NarrateRequest[] = [];
    const outcome = await probeTools(port({ capabilities: capabilities({ tools: false }), seen }));
    expect(outcome.ran).toBe(false);
    expect(outcome.detail).toContain('NARRATOR_TOOLS=on');
    expect(seen).toHaveLength(0);
  });

  it('envoie un seul outil et le signale quand le modèle l’appelle', async () => {
    const seen: NarrateRequest[] = [];
    const calling = port({
      seen,
      narrer(): AsyncIterable<NarrateEvent> {
        return (async function* stream(): AsyncGenerator<NarrateEvent> {
          await Promise.resolve();
          yield {
            type: 'tool_call',
            call: {
              type: 'tool_use',
              callId: 'c1',
              tool: PROBE_TOOL.name,
              input: { name: 'Ulrun' },
            },
          };
        })();
      },
    });
    const outcome = await probeTools(calling);
    expect(outcome).toMatchObject({ ran: true, toolCallSeen: true });
    expect(outcome.detail).toContain(PROBE_TOOL.name);
  });

  it('dit « aucun appel » quand le modèle répond en prose', async () => {
    const seen: NarrateRequest[] = [];
    const outcome = await probeTools(port({ seen }));
    expect(outcome).toMatchObject({ ran: true, toolCallSeen: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tools).toHaveLength(1);
    expect(seen[0]?.toolPolicy).toBe('auto');
  });

  it('voit l’appel même quand il n’arrive que sur le résultat de fin', async () => {
    const late = port({
      narrer(): AsyncIterable<NarrateEvent> {
        return (async function* stream(): AsyncGenerator<NarrateEvent> {
          await Promise.resolve();
          yield {
            type: 'end',
            result: {
              text: '',
              finish: 'tool_call',
              toolCalls: [
                { type: 'tool_use', callId: 'c1', tool: PROBE_TOOL.name, input: { name: 'Ulrun' } },
              ],
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
              providerModel: 'modele-x',
              latencyMs: 1,
            },
          };
        })();
      },
    });
    const outcome = await probeTools(late);
    expect(outcome).toMatchObject({ ran: true, toolCallSeen: true });
    expect(outcome.detail).toContain(PROBE_TOOL.name);
  });

  it('un flux qui se ferme sans événement de fin le dit, et ne devine rien', async () => {
    const silent = port({
      narrer(): AsyncIterable<NarrateEvent> {
        return (async function* stream(): AsyncGenerator<NarrateEvent> {
          await Promise.resolve();
          yield { type: 'delta', text: 'du texte' };
        })();
      },
    });
    const outcome = await probeTools(silent);
    expect(outcome).toMatchObject({ ran: true, toolCallSeen: false });
    expect(outcome.detail).toContain('sans événement de fin');
  });

  it('une panne qui n’est pas une NarratorError rend quand même une raison lisible', async () => {
    const broken = port({
      narrer(): AsyncIterable<NarrateEvent> {
        return (async function* stream(): AsyncGenerator<NarrateEvent> {
          await Promise.resolve();
          if (Date.now() >= 0) throw new TypeError('fetch failed');
          yield { type: 'delta', text: '' };
        })();
      },
    });
    const outcome = await probeTools(broken);
    expect(outcome.detail).toContain('fetch failed');
  });

  it('un fournisseur injoignable rend false avec sa raison, jamais une exception', async () => {
    const broken = port({
      narrer(): AsyncIterable<NarrateEvent> {
        return (async function* stream(): AsyncGenerator<NarrateEvent> {
          await Promise.resolve();
          if (Date.now() >= 0) {
            throw new NarratorError({
              code: 'unavailable',
              providerId: 'ollama',
              message: 'coupé',
            });
          }
          yield { type: 'delta', text: '' };
        })();
      },
    });
    const outcome = await probeTools(broken);
    expect(outcome).toMatchObject({ ran: true, toolCallSeen: false });
    expect(outcome.detail).toContain('unavailable');
  });
});
