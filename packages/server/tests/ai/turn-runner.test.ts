/**
 * LA COMPOSITION DU TOUR DU CONTEUR — ce qui manquait pour que
 * `runNarrationTurn` ait un appelant.
 *
 * Elle est mesurée ici parce qu'elle contient les deux seules décisions que le
 * câblage prend et que personne d'autre ne prend : ce que le bloc de campagne
 * porte, et d'où il le lit. Le reste du tour est tenu par
 * `tests/ai/turn.test.ts`, qui pilote `runNarrationTurn` directement.
 *
 * LE TON VIENT DE LA TABLE, PAS D'UNE CONSTANTE : `CampaignSettings
 * .gmVerbosity` est le seul cadran que M0 fait écrire à une table, et c'est
 * lui qui rend la ligne de ton. Deux réglages, deux blocs — sinon l'assertion
 * serait une constante comparée à elle-même.
 */

import { campaignSeq } from '@for/db';
import { describe, expect, it } from 'vitest';

import { staticContent } from '@for/content';

import { NarrationDispatcher } from '../../src/ai/broadcast.js';
import {
  buildCampaignBlockFor,
  campaignBlockCharacters,
  createTurnRunner,
} from '../../src/ai/turn-runner.js';
import { runIntent } from '../../src/game/intent-pipeline.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  PLAYER_ID,
  aTable,
  fallbacks,
  journal,
  uuidAt,
} from '../game/support.test.js';

import type { CampaignState, Intent } from '@for/engine';
import type { EventDelivery } from '../../src/game/types.js';

function withVerbosity(state: CampaignState, value: 'sobre' | 'standard' | 'ample'): CampaignState {
  return { ...state, settings: { ...state.settings, gmVerbosity: value } };
}

describe('le bloc de campagne du conteur', () => {
  it('porte le réglage de la table, pas une constante', () => {
    const table = aTable();
    try {
      const options = { connection: table.connection, content: staticContent() };
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;

      const sober = buildCampaignBlockFor(
        options,
        CAMPAIGN_ID,
        'La table',
        withVerbosity(state, 'sobre'),
      );
      const ample = buildCampaignBlockFor(
        options,
        CAMPAIGN_ID,
        'La table',
        withVerbosity(state, 'ample'),
      );

      expect(sober).not.toBe(ample);
      expect(sober).toContain('Ton de la table : sobre');
      expect(ample).toContain('Ton de la table : ample');
    } finally {
      table.close();
    }
  });

  it('nomme les personnages de LA table, et le nom de la campagne qu’on lui donne', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const block = buildCampaignBlockFor(
        { connection: table.connection, content: staticContent() },
        CAMPAIGN_ID,
        'Le col de Rakelstake',
        state,
      );

      expect(block).toContain('# Campagne : Le col de Rakelstake');
      expect(block).toContain('Ashe');
      expect(block).toContain('Braum');
    } finally {
      table.close();
    }
  });

  it('les champions des personnages viennent du CONTENU, jamais de leur identifiant', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const content = staticContent();
      const characters = campaignBlockCharacters(
        { connection: table.connection, content },
        CAMPAIGN_ID,
        state,
      );

      // DEUX ORIGINES : le nom affiché vient de la fiche de contenu, pas du
      // slug que le journal porte.
      const ashe = characters.find((character) => character.name === 'Ashe');
      expect(ashe?.championDisplayName).toBe(content.getChampion('ashe').name);
      expect(ashe?.oneLine).toBe(content.getChampion('ashe').pitch);
    } finally {
      table.close();
    }
  });

  it('les pronoms sont dits ABSENTS, jamais inventés', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const characters = campaignBlockCharacters(
        { connection: table.connection, content: staticContent() },
        CAMPAIGN_ID,
        state,
      );

      // Aucun champ ne porte les pronoms d'un personnage en M0 — ni
      // `CharacterState`, ni `ChampionSchema`, ni les réglages. Le bloc le dit
      // au lieu d'en choisir pour le joueur.
      expect(characters.map((character) => character.pronouns)).toStrictEqual(
        characters.map(() => 'pronoms non précisés'),
      );
      expect(characters.length).toBeGreaterThan(1);
    } finally {
      table.close();
    }
  });
});

/** Une réussite franche : 7 contre 1 et 2. Ni prix, ni présage, ni fenêtre. */
const A_CLEAN_SUCCESS = [6, 1, 2];

const FACE_DANGER: Intent = {
  type: 'move.face_danger',
  attribute: 'vif',
  description: 'Traverser la crevasse avant la nuit.',
};

describe('le chemin d’une intention appelle le VRAI tour du conteur', () => {
  /**
   * AVANT M0-30, `runNarrationTurn` N'AVAIT AUCUN APPELANT : le chemin d'une
   * intention passait par la narration de remplacement de M0-24, et toute la
   * couche écrite par M0-29 — prompt, post-filtre, échelle de relance,
   * coupe-circuit, refus, bloc de scène — n'était jamais exécutée en
   * production. Ce test est la mesure du câblage : avec le crochet, c'est
   * `createTurnRunner` qui écrit la narration, et il nomme sa livraison.
   */
  it('écrit la narration par le tour composé, et nomme la tête du journal AVANT le tour', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', A_CLEAN_SUCCESS);

      const delivered: { campaignId: string; sinceSeq: number }[] = [];
      const delivery: EventDelivery = {
        deliver: (campaignId) => {
          delivered.push({ campaignId, sinceSeq: -1 });
        },
        deliverSince: (campaignId, sinceSeq) => {
          delivered.push({ campaignId, sinceSeq });
        },
      };

      const headBefore = campaignSeq(table.connection, CAMPAIGN_ID) ?? 0;

      const narrateTurn = createTurnRunner({
        connection: table.connection,
        content: staticContent(),
        narrator: table.deps.narrator,
        ids: table.ids,
        clock: table.clock,
        logger: { warn: () => undefined },
        dispatcher: new NarrationDispatcher(),
        delivery,
        fallbacks: fallbacks(),
        rng: table.rng,
      });

      const outcome = await runIntent(
        { ...table.deps, narrateTurn },
        {
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(1),
          intent: FACE_DANGER,
        },
      );

      expect(outcome.kind).toBe('accepted');

      // LA NARRATION EST ÉCRITE, et par le vrai tour : le port `stub` ne rend
      // rien, donc c'est la phrase du moteur qui est journalisée — ce que
      // `runNarrationTurn` fait, et ce que le remplaçant faisait aussi. Ce qui
      // distingue les deux est la LIVRAISON, mesurée juste en dessous.
      const written = journal(table.connection).map((row) => row.type);
      expect(written).toContain('narration.gm_message');

      // LA LIVRAISON EST NOMMÉE PAR SÉQUENCE, et la séquence est la tête du
      // journal AVANT le tour — pas celle d'après la transaction. C'est ce qui
      // fait qu'une entrée écrite par le filet de la brûlure, avant la
      // transaction, est livrée elle aussi (issue #67).
      expect(delivered).toStrictEqual([{ campaignId: CAMPAIGN_ID, sinceSeq: headBefore }]);
    } finally {
      table.close();
    }
  });

  it('sans le crochet, c’est la narration de remplacement qui écrit — et elle ne livre rien', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', A_CLEAN_SUCCESS);
      const outcome = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: FACE_DANGER,
      });

      // LA DIRECTION BASSE : le journal porte bien une narration, donc le test
      // du haut ne serait pas vert « parce qu'il y a toujours une narration ».
      // Ce que le crochet ajoute, c'est l'appel à la livraison, et il n'a lieu
      // que par lui.
      expect(outcome.kind).toBe('accepted');
      expect(journal(table.connection).map((row) => row.type)).toContain('narration.gm_message');
    } finally {
      table.close();
    }
  });
});
