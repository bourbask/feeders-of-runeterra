/**
 * LE BARIL DE `src/ai`, et ce qu'il promet au câblage.
 *
 * Troisième fichier écrit d'après le rapport de couverture : `src/ai/index.ts`
 * était à **0 %** — un baril que rien n'importait. Ce n'est pas une ligne à
 * colorer : c'est la SURFACE que M0-30 consommera pour brancher le hub, et un
 * export manquant ne se verrait qu'à ce moment-là, une vague plus tard.
 *
 * ── ET IL NE RÉEXPORTE PAS `narrator.ts` ──────────────────────────────────
 * Ce fichier appartient à M0-24 et c'est le SEUL endroit du serveur qui lit la
 * configuration du port (01-architecture.md §2.8). Le faire passer par un
 * baril donnerait à ce point de lecture unique l'air d'une frontière de
 * module, ce qu'il n'est pas.
 */

import { describe, expect, it } from 'vitest';

import * as barrel from '../../src/ai/index.js';

describe('le baril de src/ai', () => {
  it('expose ce que le câblage de M0-30 aura à importer', () => {
    // LES NOMS EN TOUTES LETTRES, pas un compte : un baril gardé par
    // `Object.keys(barrel).length > 20` laisserait passer n'importe quelle
    // substitution. Et la liste est comparée D'UN COUP, pas nom par nom : un
    // `expect` par tour de boucle dirait lequel manque, mais un tableau
    // manquant en dirait autant et tombe pour de bon.
    const expected = [
      'NarrationDispatcher',
      'NarrationBroadcast',
      'narrationVisibleTo',
      'NarratorBreaker',
      'recordAiCall',
      'narratorPlan',
      'compactChronicle',
      'forgeChampionSheet',
      'reservedChampions',
      'applyProposal',
      'applyRefusal',
      'applySceneBlock',
      'runNarrationTurn',
      'assertProposalWritable',
      'assertOracleWritable',
      'assertRefusalWritable',
      'gateEvents',
      'trimmableContext',
      'factVocabulary',
    ];
    const missing = expected.filter((name) => !Object.hasOwn(barrel, name));
    expect(missing).toEqual([]);
  });

  it('et il ne réexporte PAS le point de lecture de la configuration', () => {
    expect(barrel).not.toHaveProperty('buildNarrator');
    expect(barrel).not.toHaveProperty('builtinSelector');
  });
});
