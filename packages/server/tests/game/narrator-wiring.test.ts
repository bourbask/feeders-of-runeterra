/**
 * QUEL FOURNISSEUR LE SERVEUR COMPOSE, POUR UNE CONFIGURATION DONNÉE.
 *
 * Mesuré en recette de M0-30, sur le vrai serveur, `NARRATOR_PROVIDER=ollama` :
 * `narration.gm_failed`, `errorKind: api_error`, repli du moteur, et AUCUNE
 * socket ouverte vers le fournisseur. `game/index.ts` appelait
 * `buildNarrator(deps.env)` sans le sélecteur ; `builtinSelector` rend donc
 * `unavailableNarrator` pour tout ce qui n'est pas `stub`. Dans AUCUNE
 * configuration ce serveur ne parlait à un modèle.
 *
 * Personne ne l'avait vu parce que le repli marche : le tour se résout, le
 * journal grandit, la phrase du moteur arrive au joueur. C'est le premier mode
 * de `docs/RECETTE.md` appliqué à un composant entier — présent, et inerte.
 *
 * ── CE QUE CE FICHIER MESURE, ET COMMENT IL ROUGIT ───────────────────────
 * Il lit le décorateur `app.narrator` : LE PORT QUE LE PROCESSUS A VRAIMENT
 * COMPOSÉ, pas un port rebâti ici. Remets `buildNarrator(deps.env)` nu dans
 * `game/index.ts` et les trois fournisseurs réseau tombent — `streaming` et
 * `structuredOutput` passent à `false`, et `narrer()` lève `unavailable` au
 * lieu d'ouvrir quoi que ce soit.
 *
 * ── DEUX OPÉRANDES, DEUX CHEMINS ─────────────────────────────────────────
 * Le premier vient de `buildApp`, le second de `selectNarrator` appelé
 * directement depuis `@for/ai`. Ils ne remontent pas à la même définition, et
 * les drapeaux qui les séparent de `unavailableNarrator` sont en plus écrits
 * EN TOUTES LETTRES ci-dessous, pour qu'un sélecteur cassé des deux côtés ne
 * laisse pas l'assertion verte.
 *
 * ── AUCUN APPEL RÉSEAU ICI, NI À L'AMORÇAGE ──────────────────────────────
 * Choisir un adaptateur n'ouvre rien : `selectNarrator` lit `globalThis.fetch`
 * et construit un objet. Le dernier cas du fichier le dit pour le dépôt
 * public : sans réglage, c'est `stub`, et `stub` n'a pas de transport.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { selectNarrator } from '@for/ai';
import { staticContent } from '@for/content';
import { createDb, migrateConnection } from '@for/db';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { envVars } from '../../src/auth/testing.js';
import { campaignRng, createUlidFactory, systemClock } from '../../src/deps.js';
import { narratorConfig, readEnv } from '../../src/env.js';
import { createLogger } from '../../src/logger.js';

import type { NarratorPort } from '@for/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../src/deps.js';

const EPOCH = 1_700_000_000_000;

let open: { app: FastifyInstance; close: () => void }[] = [];

afterEach(async () => {
  const live = open;
  open = [];
  for (const one of live) {
    await one.app.close();
    one.close();
  }
});

/** Une application complète, sur une vraie base migrée, avec cet environnement-là. */
async function anAppWith(vars: Record<string, string>): Promise<FastifyInstance> {
  const folder = mkdtempSync(join(tmpdir(), 'for-m030-narrator-'));
  const path = join(folder, 'app.db');
  const { connection, db } = createDb(path);
  migrateConnection(connection);

  const deps: AppDeps = {
    env: readEnv(envVars({ ...vars, DATABASE_PATH: path })),
    logger: createLogger({ level: 'fatal', nodeEnv: 'test' }),
    connection,
    db,
    content: staticContent(),
    clock: systemClock,
    rng: campaignRng,
    ids: createUlidFactory(systemClock),
    startedAt: EPOCH,
  };

  const app = await buildApp(deps);
  open.push({
    app,
    close: () => {
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    },
  });
  return app;
}

/**
 * Les quatre configurations, et le fournisseur que chacune doit donner.
 *
 * `baseUrl` et `apiKey` sont ceux que `env.ts` EXIGE de la configuration, pas
 * des secrets : `127.0.0.1:1` ne répond pas, et rien ici ne compose un appel.
 */
const CONFIGURATIONS: readonly {
  readonly label: string;
  readonly vars: Record<string, string>;
  readonly providerId: string;
}[] = [
  { label: 'stub', vars: { NARRATOR_PROVIDER: 'stub' }, providerId: 'stub' },
  {
    label: 'anthropic',
    vars: { NARRATOR_PROVIDER: 'anthropic', NARRATOR_API_KEY: 'cle-de-test' },
    providerId: 'anthropic',
  },
  {
    label: 'openai-compatible',
    vars: {
      NARRATOR_PROVIDER: 'openai-compatible',
      NARRATOR_BASE_URL: 'http://127.0.0.1:1',
      NARRATOR_API_KEY: 'cle-de-test',
    },
    providerId: 'openai-compatible',
  },
  {
    label: 'ollama',
    vars: { NARRATOR_PROVIDER: 'ollama', NARRATOR_BASE_URL: 'http://127.0.0.1:1' },
    providerId: 'ollama',
  },
];

describe('le fournisseur que le serveur compose', () => {
  it.each(CONFIGURATIONS)(
    'NARRATOR_PROVIDER=$label donne l’adaptateur « $providerId » d’@for/ai',
    async ({ vars, providerId }) => {
      const app = await anAppWith(vars);
      const composed = app.narrator;
      expect(composed).toBeDefined();
      expect(composed?.providerId).toBe(providerId);

      // DEUXIÈME CHEMIN : ce que `@for/ai` choisit pour la MÊME configuration,
      // appelé ici sans passer par le serveur.
      const expected = selectNarrator(narratorConfig(readEnv(envVars(vars))));
      expect(composed?.capabilities).toEqual(expected.capabilities);
    },
  );

  /**
   * CE QUI SÉPARE UN ADAPTATEUR DU PORT « INDISPONIBLE », en toutes lettres.
   *
   * `unavailableNarrator` annonce `streaming: false` et `structuredOutput:
   * false` et lève à l'appel. Les trois adaptateurs réseau annoncent les deux
   * à `true`. Sans cette assertion, l'égalité de capacités ci-dessus resterait
   * verte si les deux chemins se cassaient ensemble.
   */
  it.each(CONFIGURATIONS.filter((one) => one.providerId !== 'stub'))(
    'un fournisseur réseau ($label) diffuse et rend du structuré — le port « indisponible », non',
    async ({ vars }) => {
      const app = await anAppWith(vars);
      expect(app.narrator?.capabilities.streaming).toBe(true);
      expect(app.narrator?.capabilities.structuredOutput).toBe(true);
    },
  );

  it('et il ne lève PAS « unavailable » à l’appel : un adaptateur existe', async () => {
    const app = await anAppWith({
      NARRATOR_PROVIDER: 'ollama',
      NARRATOR_BASE_URL: 'http://127.0.0.1:1',
    });
    // `narrer()` rend un itérable PARESSEUX : l'appel seul n'ouvre rien. Le
    // port non branché, lui, lève AVANT d'avoir rien à itérer.
    const port = app.narrator!;
    expect(() =>
      port.narrer({
        purpose: 'narration',
        requestId: 'wiring',
        system: [],
        messages: [],
        tools: [],
        toolPolicy: 'none',
        maxOutputTokens: 16,
        effort: 'low',
      } as unknown as Parameters<NarratorPort['narrer']>[0]),
    ).not.toThrow();
  });

  /**
   * LE DÉFAUT PAR DÉFAUT DU DÉPÔT EST `stub`. Le dépôt est public : un serveur
   * qui tenterait un appel réseau à l'amorçage, clé absente, n'est pas
   * acceptable. `NARRATOR_PROVIDER` n'a pas de valeur par défaut dans `env.ts`
   * — un environnement muet ne démarre pas du tout — et les fichiers que le
   * dépôt livre disent tous `stub`.
   */
  it('le réglage livré par le dépôt est `stub`, et `stub` n’a aucun transport', async () => {
    const app = await anAppWith({});
    expect(app.narrator?.providerId).toBe('stub');
    expect(app.narrator?.capabilities.promptCache).toBe(false);
    expect(envVars()['NARRATOR_PROVIDER']).toBe('stub');

    // LES FICHIERS QUE LE DÉPÔT LIVRE, LUS ICI. Un commentaire qui l'affirme
    // ne vaut rien : les deux sont ce qu'un nouvel arrivant copie, et une clé
    // n'est demandée par aucun des deux.
    const root = new URL('../../../../', import.meta.url);
    for (const file of ['.env.example', 'infra/docker-compose.dev.yml']) {
      const text = readFileSync(new URL(file, root), 'utf8');
      expect(text).toMatch(/NARRATOR_PROVIDER[:=] ?stub/u);
    }
    // La clé est livrée VIDE : rien à copier, rien à oublier dans un dépôt public.
    expect(readFileSync(new URL('.env.example', root), 'utf8')).toMatch(
      /^NARRATOR_API_KEY= *(#.*)?$/mu,
    );
  });
});
