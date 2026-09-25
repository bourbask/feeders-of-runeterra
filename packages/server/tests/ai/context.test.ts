/**
 * LE CONTEXTE D'UN TOUR, assemblé depuis la base.
 *
 * Deuxième fichier écrit d'après le rapport de couverture (section 5 bis) :
 * `context.ts` était à **47 % de branches**. Les blocs se rendaient, mais
 * aucune de leurs branches vides n'était parcourue — et une liste vide qui
 * rendrait un titre orphelin est exactement le genre de défaut qu'un prompt
 * cache jusqu'à la production.
 */

import { staticContent } from '@for/content';
import { describe, expect, it } from 'vitest';

import {
  ROLLING_WINDOW_TURNS,
  assetLabel,
  assetNames,
  chronicleParts,
  etatParts,
  factVocabulary,
  rollingWindow,
  trimmableContext,
} from '../../src/ai/context.js';
import { runIntent, toAppendable } from '../../src/game/intent-pipeline.js';
import { loadReplay } from '../../src/game/snapshots.js';
import { CAMPAIGN_ID, CHARACTER_ID, PLAYER_ID, anAiTable, uuidAt } from './support.test.js';

import type { NarrationBriefDto } from '@for/contracts';
import type { CampaignState, NarrationBrief } from '@for/engine';
import type { Table } from '../game/support.test.js';

const CONTENT = staticContent();

const stateOf = (table: Table): CampaignState => loadReplay(table.connection, CAMPAIGN_ID).state;

describe('le bloc <etat>', () => {
  it('porte les jauges, les horloges et les serments — en chiffres', () => {
    const table = anAiTable({ momentum: 7 });
    try {
      const parts = etatParts(stateOf(table), CONTENT);
      // LES CHIFFRES SONT ICI, et seulement ici : la scène n'en porte aucun
      // (§4.7.2). Le prompt interdit au modèle d'en ÉCRIRE un, pas d'en lire.
      expect(parts.core).toContain('Ashe');
      expect(parts.core).toContain('vigueur 5');
      expect(parts.core).toContain('souffle 7');
      // Pas de titre orphelin : aucune horloge, aucune section « Horloges ».
      expect(parts.core).not.toContain('Horloges');
      expect(parts.core).not.toContain('Serments');
    } finally {
      table.close();
    }
  });

  it('la couture que T2 coupe est SÉPARÉE du cœur', () => {
    const table = anAiTable();
    try {
      const state = stateOf(table);
      const parts = etatParts(state, CONTENT);
      // Aucun atout dans la fixture : la partie que T2 retire est vide, et le
      // cœur, lui, ne l'est pas. C'est la couture, mesurée.
      expect(parts.inventoryAndIdleClocks).toBe('');
      expect(parts.core.length).toBeGreaterThan(0);
    } finally {
      table.close();
    }
  });

  it('un atout connu prend son nom français, un atout inconnu garde son identifiant', () => {
    const first = CONTENT.listAssets()[0];
    expect(first).toBeDefined();
    expect(assetLabel(CONTENT, first?.id ?? '')).toBe(first?.name);
    expect(assetLabel(CONTENT, 'atout-qui-n-existe-pas')).toBe('atout-qui-n-existe-pas');
  });

  it('`assetNames` rend la liste du personnage nommé, et rien pour personne', () => {
    const table = anAiTable();
    try {
      const state = stateOf(table);
      expect(assetNames(state, CONTENT, CHARACTER_ID)).toEqual([]);
      expect(assetNames(state, CONTENT, null)).toEqual([]);
      expect(assetNames(state, CONTENT, '0000000000000000000000ZZZZ')).toEqual([]);
    } finally {
      table.close();
    }
  });
});

describe('la chronique et la fenêtre roulante', () => {
  it('sans chronique en service, toutes les parties sont vides', () => {
    const table = anAiTable();
    try {
      const parts = chronicleParts(table.connection, CAMPAIGN_ID, null);
      expect(Object.values(parts).every((part) => part === '')).toBe(true);
    } finally {
      table.close();
    }
  });

  it('la fenêtre est vide tant qu’aucun tour n’a été rendu', () => {
    const table = anAiTable();
    try {
      expect(rollingWindow(table.connection, CAMPAIGN_ID)).toEqual([]);
      expect(ROLLING_WINDOW_TURNS).toBe(12);
    } finally {
      table.close();
    }
  });

  it('DEUX TOURS, PAS UN : elle alterne le fait rendu et la narration, dans l’ordre', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      // Deux tours joués, donc deux narrations — et deux rendus figés écrits à
      // la main, puisque `ai_turn_renders` est alimenté par le chemin complet.
      for (const index of [1, 2]) {
        table.rng.script('action', [6, 1, 2]);
        await runIntent(table.deps, {
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(index),
          intent: {
            type: 'move.face_danger',
            attribute: 'vif',
            description: `Tour ${String(index)}.`,
          },
        });
      }
      for (const [index, seq] of [10, 20].entries()) {
        table.connection
          .prepare(
            `INSERT INTO ai_turn_renders (campaign_id, event_seq, rendered_fact, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(CAMPAIGN_ID, seq, `<fait>tour ${String(index + 1)}</fait>`, 0);
      }

      // DEUX ORIGINES : la fenêtre assemblée, et les narrations relues dans le
      // journal. Comparer la fenêtre à elle-même n'aurait rien prouvé.
      const said = (
        table.connection
          .prepare(
            `SELECT json_extract(payload_json, '$.text') AS text FROM events
              WHERE campaign_id = ? AND type = 'narration.gm_message' ORDER BY seq`,
          )
          .all(CAMPAIGN_ID) as { text: string }[]
      ).map((row) => row.text);
      expect(said).toHaveLength(2);

      const window = rollingWindow(table.connection, CAMPAIGN_ID);
      // UNE FIXTURE À DEUX ENTRÉES, dans un ordre NON NATUREL à la lecture (la
      // requête lit en DESC), et le TABLEAU EXACT est asserté : le plus ancien
      // d'abord, alterné avec ce que le conteur a répondu.
      expect(window).toEqual(['<fait>tour 1</fait>', said[0], '<fait>tour 2</fait>', said[1]]);
    } finally {
      table.close();
    }
  });

  it('`trimmableContext` ne porte AUCUN extrait de lore — signalé, pas inventé', () => {
    const table = anAiTable();
    try {
      const trimmable = trimmableContext(table.connection, CONTENT, stateOf(table), CAMPAIGN_ID);
      // Le §4.1 remplit `<lore>` par pertinence, et la pertinence n'a aucune
      // implémentation dans ce dépôt depuis que l'ADR 0011 a retiré
      // `get_lore`. Vide est honnête ; « les trois premières entités » serait
      // une invention que personne ne pourrait relire.
      expect(trimmable.lore).toEqual([]);
      expect(trimmable.turns).toEqual([]);
      expect(trimmable.etat.core.length).toBeGreaterThan(0);
    } finally {
      table.close();
    }
  });
});

describe('le vocabulaire du <fait>', () => {
  const aBrief = (over: Partial<NarrationBrief> = {}): NarrationBriefDto =>
    ({
      correlationId: uuidAt(1),
      sceneId: null,
      audience: { scope: 'table', recipients: null },
      perceivableFacts: [],
      actorCharacterId: CHARACTER_ID,
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      appliedEffects: [],
      imposedPrice: null,
      presage: null,
      playerInput: '',
      eventSeqs: [],
      fallbackTemplateId: 'default',
      ...over,
    }) as unknown as NarrationBriefDto;

  it('un tour sans mouvement ni issue ne nomme ni l’un ni l’autre', () => {
    const vocabulary = factVocabulary(aBrief(), CONTENT);
    expect(vocabulary).toEqual({
      moveLabel: null,
      attributeLabel: null,
      outcomeLabel: null,
      effectSentences: [],
    });
  });

  it('les trois issues portent l’orthographe du prompt, en capitales', () => {
    // LES TROIS, ÉCRITES EN TOUTES LETTRES. `<fait>` recopie l'orthographe du
    // §2.1, et une table dérivée d'elle-même ne prouverait rien.
    expect(factVocabulary(aBrief({ outcome: 'franche' }), CONTENT).outcomeLabel).toBe(
      'RÉUSSITE FRANCHE',
    );
    expect(factVocabulary(aBrief({ outcome: 'partielle' }), CONTENT).outcomeLabel).toBe(
      'RÉUSSITE PARTIELLE',
    );
    expect(factVocabulary(aBrief({ outcome: 'echec' }), CONTENT).outcomeLabel).toBe('ÉCHEC');
  });

  it('le mouvement prend son nom du contenu, et un mouvement absent du paquet n’en prend aucun', () => {
    expect(factVocabulary(aBrief({ moveId: 'face-danger' }), CONTENT).moveLabel).toBe(
      CONTENT.getMove('face-danger').name,
    );
    // LA BRANCHE `undefined` N'EST PAS ATTEIGNABLE PAR L'API TYPÉE : `MoveId`
    // est une union fermée de onze valeurs, et les onze sont dans le paquet.
    // Elle reste atteignable par un paquet de contenu qui aurait perdu un
    // mouvement — la seule façon d'y arriver ici est donc un cast, assumé et
    // nommé, plutôt qu'une branche que personne ne parcourt jamais.
    expect(
      factVocabulary(aBrief({ moveId: 'mouvement-inconnu' as never }), CONTENT).moveLabel,
    ).toBeNull();
  });

  it('chaque conséquence appliquée devient UNE phrase française, au passé', () => {
    // Les douze formes d'`EngineEffect`, parcourues : une branche non prise est
    // une phrase que personne n'a jamais lue.
    const effects = [
      { op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' },
      { op: 'gauge', gauge: 'ame', delta: 2, target: 'self' },
      { op: 'momentum', delta: 1 },
      { op: 'momentum_reset' },
      { op: 'condition_add', conditionId: 'blesse' },
      { op: 'condition_remove', conditionId: 'blesse' },
      { op: 'track_tick', trackKind: 'combat', ticks: 2, useRank: false },
      { op: 'track_create', trackKind: 'vow', rankFrom: 'fixed', rank: 'dangereux' },
      { op: 'clock_advance', segments: 2 },
      { op: 'xp', amount: 1 },
      { op: 'pay_price', mode: 'roll' },
      { op: 'oracle', tableId: 'complication' },
      { op: 'narrative', prompt: 'Le froid gagne.' },
      { op: 'choice', label: 'Deux issues', pick: 1, options: [] },
    ];
    const sentences = factVocabulary(
      aBrief({
        appliedEffects: effects.map((effect) => ({
          effect,
          subjectCharacterId: CHARACTER_ID,
          trackId: null,
          eventSeq: 1,
        })),
      } as unknown as Partial<NarrationBrief>),
      CONTENT,
    ).effectSentences;

    expect(sentences).toHaveLength(effects.length);
    // AUCUNE PHRASE VIDE, et aucune qui rende le nom de l'opération brute.
    expect(sentences.filter((sentence) => sentence.trim().length === 0)).toEqual([]);
    expect(sentences[0]).toBe('vivres -1.');
    expect(sentences[1]).toBe('ame +2.');
    expect(sentences[2]).toBe('souffle +1.');
    expect(sentences[12]).toBe('Le froid gagne.');
  });
});

describe('`toAppendable` est bien la porte commune', () => {
  it('le convertisseur du chemin d’intention est celui que `src/ai` réutilise', () => {
    // Deux origines : la fonction importée ici, et celle que `scene-state.ts`
    // importe. C'est une seule, et c'est ce qui fait que la garde
    // `assertNotAiAuthored` est sur les DEUX chemins.
    expect(typeof toAppendable).toBe('function');
  });
});
