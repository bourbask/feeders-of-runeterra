/**
 * Issue #95 — l'adaptateur passerelle éteint le raisonnement du fournisseur.
 *
 * CE QUI SE MESURE EST LE CORPS DE LA REQUÊTE, pas le fait qu'elle parte. Le
 * défaut d'origine envoyait une requête parfaitement valide à laquelle le
 * fournisseur répondait 200 ; seul son corps disait que rien n'avait été
 * demandé. Mesuré en production : `finish: length`, 800 jetons de complétion
 * dont 800 de raisonnement, ZÉRO caractère de prose, douze fois sur douze.
 *
 * LES DEUX SENS SONT ICI : `off` met le champ, `on` ne le met pas. Sans le
 * second cas, coder `reasoning: {enabled:false}` en dur passerait ce fichier
 * tout en rendant le réglage inopérant — et un réglage qui ne règle rien est
 * exactement le garde-fou inerte que `docs/RECETTE.md` répertorie.
 *
 * `narrer` ET `structurer` : le plafond de complétion s'applique aux deux, et
 * ils construisent leur corps séparément.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createOpenAiCompatibleNarrator } from '../src/narrator/adapters/openai-compatible.js';
import { collect, configFor, scriptedFetch } from './support.js';

import type { NarratorReasoningMode } from '@for/contracts';
import type { NarratorFetch } from '../src/narrator/http.js';

const narrateRequest = {
  purpose: 'narration' as const,
  requestId: 'reasoning',
  system: [{ type: 'text' as const, text: 's' }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'u' }] }],
  tools: [],
  toolPolicy: 'none' as const,
  maxOutputTokens: 800,
  effort: 'low' as const,
};

const structureRequest = {
  purpose: 'chronicle' as const,
  requestId: 'reasoning_s',
  system: [{ type: 'text' as const, text: 's' }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'u' }] }],
  schema: z.object({ titre: z.string() }),
  schemaName: 'chronique',
  maxOutputTokens: 800,
  effort: 'low' as const,
};

const answering = (body: string): NarratorFetch & { readonly calls: { init: RequestInit }[] } =>
  scriptedFetch(() => new Response(body, { status: 200 }));

const bodyOf = (calls: readonly { init: RequestInit }[]): Record<string, unknown> =>
  JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;

const portWith = (
  reasoning: NarratorReasoningMode,
  transport: NarratorFetch,
): ReturnType<typeof createOpenAiCompatibleNarrator> =>
  createOpenAiCompatibleNarrator(configFor('openai-compatible', { reasoning }), {
    fetch: transport,
  });

const STRUCTURED_ANSWER = JSON.stringify({
  model: 'w',
  choices: [{ message: { content: '{"titre":"x"}' } }],
  usage: {},
});

describe('reasoning: off — le champ part sur le fil', () => {
  it('narrer envoie reasoning.enabled === false', async () => {
    const transport = answering('');
    await collect(portWith('off', transport).narrer(narrateRequest)).catch(() => undefined);

    expect(transport.calls).toHaveLength(1);
    expect(bodyOf(transport.calls)['reasoning']).toStrictEqual({ enabled: false });
  });

  it('structurer aussi — le plafond de complétion vaut pour lui également', async () => {
    const transport = answering(STRUCTURED_ANSWER);
    await portWith('off', transport).structurer(structureRequest);

    expect(bodyOf(transport.calls)['reasoning']).toStrictEqual({ enabled: false });
  });

  it("c'est bien le défaut livré : une configuration d'environnement nue éteint", () => {
    // Le défaut vit dans le schéma d'`env.ts` et il est tenu là-bas ; ce que
    // ce cas garde, c'est que la valeur `off` parvienne À L'ADAPTATEUR.
    expect(configFor('openai-compatible').reasoning).toBe('off');
  });
});

describe('reasoning: on — le champ ne part pas, le fournisseur décide', () => {
  it('narrer ne porte aucune clé reasoning', async () => {
    const transport = answering('');
    await collect(portWith('on', transport).narrer(narrateRequest)).catch(() => undefined);

    expect(bodyOf(transport.calls)).not.toHaveProperty('reasoning');
  });

  it('structurer non plus', async () => {
    const transport = answering(STRUCTURED_ANSWER);
    await portWith('on', transport).structurer(structureRequest);

    expect(bodyOf(transport.calls)).not.toHaveProperty('reasoning');
  });

  it('et le reste du corps est inchangé entre les deux modes', async () => {
    // Un réglage qui déplacerait autre chose que `reasoning` serait un effet
    // de bord : on compare les deux corps clé à clé.
    const off = answering('');
    const on = answering('');
    await collect(portWith('off', off).narrer(narrateRequest)).catch(() => undefined);
    await collect(portWith('on', on).narrer(narrateRequest)).catch(() => undefined);

    const { reasoning, ...sansReasoning } = bodyOf(off.calls);
    expect(reasoning).toStrictEqual({ enabled: false });
    expect(sansReasoning).toStrictEqual(bodyOf(on.calls));
  });
});
