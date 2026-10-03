/**
 * Issue #89 — ni `ollama` ni `openai-compatible` ne met un modèle vide sur le fil.
 *
 * CE QUI SE MESURE N'EST PAS QU'UNE ERREUR EST LEVÉE, C'EST QU'AUCUNE REQUÊTE
 * NE PART. Le défaut d'origine partait : un vrai Ollama répondait 400, le tour
 * retombait sur le repli déterministe du moteur, et rien ne rougissait — le
 * repli marche trop bien. Il a été trouvé en lisant le CORPS de la requête,
 * pas en vérifiant qu'une requête était envoyée. D'où `calls`, et pas
 * seulement `rejects`.
 *
 * LE REFUS EST À LA CONSTRUCTION, PAS À L'APPEL, et un cas le garde : une
 * erreur levée par `narrer()` lui-même effacerait ce qui distingue un
 * adaptateur réel du port « indisponible » (`narrer()` rend un itérable
 * paresseux et ne lève pas — `packages/server/tests/game/narrator-wiring.test.ts`
 * s'appuie dessus).
 *
 * `anthropic` EST LÀ POUR LA RAISON INVERSE : lui a un défaut nommé
 * (`ANTHROPIC_DEFAULT_MODEL`), et son cas garde l'autre moitié de la ligne de
 * `.env.example`. Sans lui, rendre les trois adaptateurs exigeants laisserait
 * ce fichier vert en rendant cette ligne fausse à nouveau.
 */

import { NarratorError } from '@for/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAnthropicNarrator } from '../src/narrator/adapters/anthropic.js';
import { createOllamaNarrator } from '../src/narrator/adapters/ollama.js';
import { createOpenAiCompatibleNarrator } from '../src/narrator/adapters/openai-compatible.js';
import { collect, configFor, scriptedFetch } from './support.js';

import type { NarratorConfig, NarratorPort, NarratorProviderId } from '@for/contracts';
import type { NarratorFetch } from '../src/narrator/http.js';

type Build = (config: NarratorConfig, fetchImpl: NarratorFetch) => NarratorPort;

const BUILD: Readonly<Record<string, Build>> = {
  'openai-compatible': (config, fetchImpl) =>
    createOpenAiCompatibleNarrator(config, { fetch: fetchImpl }),
  ollama: (config, fetchImpl) => createOllamaNarrator(config, { fetch: fetchImpl }),
};

/**
 * Les deux écrits l'un après l'autre. Boucler sur `PROVIDERS_REQUIRING_MODEL`
 * du serveur rendrait le vidage de cette liste indétectable — c'est le sixième
 * mode de garde-fou inerte que ce dépôt a déjà payé.
 */
const SANS_DEFAUT: readonly NarratorProviderId[] = ['openai-compatible', 'ollama'];

const narrateRequest = {
  purpose: 'narration' as const,
  requestId: 'model_req',
  system: [{ type: 'text' as const, text: 's' }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'u' }] }],
  tools: [],
  toolPolicy: 'none' as const,
  maxOutputTokens: 400,
  effort: 'low' as const,
};

const structureRequest = {
  purpose: 'chronicle' as const,
  requestId: 'model_req_s',
  system: [{ type: 'text' as const, text: 's' }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'u' }] }],
  schema: z.object({ titre: z.string() }),
  schemaName: 'chronique',
  maxOutputTokens: 400,
  effort: 'low' as const,
};

/** Un transport qui crie si on l'appelle : rien ne doit partir. */
const interdit = (): NarratorFetch & { readonly calls: { url: string }[] } =>
  scriptedFetch(() => {
    throw new Error('une requête est partie alors que le modèle manquait');
  });

const bodyOf = (calls: readonly { init: RequestInit }[]): { model: string } =>
  JSON.parse(calls[0]!.init.body as string) as { model: string };

describe.each(SANS_DEFAUT)('%s, sans modèle configuré', (provider) => {
  const build = BUILD[provider]!;

  it.each([null, '', '   '])(
    'refuse à la construction, en model_not_found, sans ouvrir de socket — modèle %j',
    (model) => {
      const transport = interdit();

      let caught: unknown;
      try {
        build(configFor(provider, { model, modelStructured: null }), transport);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(NarratorError);
      expect((caught as NarratorError).code).toBe('model_not_found');
      expect((caught as NarratorError).providerId).toBe(provider);
      expect(transport.calls).toHaveLength(0);
    },
  );

  it('refuse même quand seul NARRATOR_MODEL_STRUCTURED est renseigné', () => {
    // Le modèle structuré ne remplace pas celui de la narration : sans ce cas,
    // `modelStructured` seul laisserait `narrer()` sans modèle.
    expect(() =>
      build(configFor(provider, { model: null, modelStructured: 'ms' }), interdit()),
    ).toThrow(NarratorError);
  });

  it('construit sans lever dès que le modèle est là, et narrer() reste paresseux', () => {
    const transport = interdit();
    const port = build(configFor(provider, { model: 'm', modelStructured: null }), transport);

    // L'APPEL SEUL N'OUVRE RIEN. C'est ce qui sépare cet adaptateur du port
    // « indisponible », qui lève avant d'avoir quoi que ce soit à itérer.
    expect(() => port.narrer(narrateRequest)).not.toThrow();
    expect(transport.calls).toHaveLength(0);
  });

  it('structurer retombe sur NARRATOR_MODEL quand seul le structuré manque', async () => {
    const transport = scriptedFetch(
      () =>
        new Response(
          provider === 'ollama'
            ? JSON.stringify({ model: 'w', message: { content: '{"titre":"x"}' } })
            : JSON.stringify({
                model: 'w',
                choices: [{ message: { content: '{"titre":"x"}' } }],
                usage: {},
              }),
          { status: 200 },
        ),
    );
    const port = build(
      configFor(provider, { model: 'modele-de-base', modelStructured: null }),
      transport,
    );

    const result = await port.structurer(structureRequest);
    expect(result.value).toStrictEqual({ titre: 'x' });
    expect(transport.calls).toHaveLength(1);
    expect(bodyOf(transport.calls).model).toBe('modele-de-base');
  });

  it('et prend NARRATOR_MODEL_STRUCTURED quand il est là', async () => {
    const transport = scriptedFetch(
      () =>
        new Response(
          provider === 'ollama'
            ? JSON.stringify({ model: 'w', message: { content: '{"titre":"x"}' } })
            : JSON.stringify({
                model: 'w',
                choices: [{ message: { content: '{"titre":"x"}' } }],
                usage: {},
              }),
          { status: 200 },
        ),
    );
    const port = build(
      configFor(provider, { model: 'modele-de-base', modelStructured: 'modele-structure' }),
      transport,
    );

    await port.structurer(structureRequest);
    expect(bodyOf(transport.calls).model).toBe('modele-structure');
  });

  it('narrer met le modèle configuré sur le fil, jamais la chaîne vide', async () => {
    const transport = scriptedFetch(
      () => new Response('', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const port = build(configFor(provider, { model: 'modele-de-base' }), transport);

    await collect(port.narrer(narrateRequest)).catch(() => undefined);

    expect(transport.calls).toHaveLength(1);
    expect(bodyOf(transport.calls).model).toBe('modele-de-base');
  });
});

describe('anthropic, l’exception assumée', () => {
  it('se passe de NARRATOR_MODEL et met son défaut nommé sur le fil', async () => {
    const transport = scriptedFetch(
      () => new Response(JSON.stringify({ model: 'w', content: [], usage: {} }), { status: 200 }),
    );
    const port = createAnthropicNarrator(
      configFor('anthropic', { model: null, modelStructured: null }),
      { fetch: transport },
    );

    await port.structurer(structureRequest).catch(() => undefined);

    expect(transport.calls).toHaveLength(1);
    expect(bodyOf(transport.calls).model).not.toBe('');
  });
});
