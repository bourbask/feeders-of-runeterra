/**
 * L'ÉTAT DE SCÈNE : un événement seulement quand quelque chose bouge, et un
 * bloc absent qui ne coûte rien.
 *
 * ── LE CAS NORMAL EST LE BLOC ABSENT, ET C'EST MESURÉ ──────────────────────
 * M0-32 a monté deux modèles gratuits locaux et les a mesurés : 24
 * échantillons, ZÉRO bloc `<scene_apres>`, sur `qwen2.5:3b` comme sur
 * `mistral:7b`. Le chemin où le modèle n'écrit pas de bloc n'est donc pas un
 * cas dégradé, c'est CELUI QUE LA TABLE PRENDRA, et il doit coûter zéro
 * événement, zéro exception et zéro relance.
 */

import { describe, expect, it } from 'vitest';

import {
  applySceneBlock,
  emptyScene,
  sceneBefore,
  sceneMergeState,
} from '../../src/ai/scene-state.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  NPC_DEAD_NAME,
  NPC_GONE_NAME,
  NPC_PRESENT_NAME,
  PLACE_ID,
  anAiTable,
  uuidAt,
} from './support.test.js';

import type { SceneBlock } from '@for/contracts';
import type { Table } from '../game/support.test.js';

const EPOCH = 1_700_000_000_000;

const block = (over: Partial<SceneBlock> = {}): SceneBlock => ({
  lieu: '',
  presents: [],
  partis: [],
  refus: null,
  ...over,
});

function merge(table: Table, input: SceneBlock | null, correlation = uuidAt(70)) {
  const state = loadReplay(table.connection, CAMPAIGN_ID).state;
  return applySceneBlock(
    { connection: table.connection, ids: table.ids },
    {
      campaignId: CAMPAIGN_ID,
      correlationId: correlation,
      causationId: null,
      state,
      block: input,
      aiCallId: '00000000000000000000000AAA',
      now: EPOCH,
    },
  );
}

const sceneEvents = (table: Table): number =>
  (
    table.connection
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND type = 'scene.facts_updated'`,
      )
      .get(CAMPAIGN_ID) as { n: number }
  ).n;

describe('un événement seulement si la fusion change quelque chose', () => {
  it('deux tours sans mouvement n’écrivent aucun événement', () => {
    const table = anAiTable();
    try {
      const before = sceneEvents(table);
      // Tour 1 : le modèle recopie la scène telle qu'elle est.
      const first = merge(
        table,
        block({
          presents: [
            { nom: 'Ashe', etat: '' },
            { nom: NPC_PRESENT_NAME, etat: 'adossé au rocher' },
          ],
        }),
        uuidAt(71),
      );
      expect(first.merge.unchanged).toBe(true);
      expect(first.event).toBeNull();

      // Tour 2 : le modèle n'écrit pas de bloc du tout.
      const second = merge(table, null, uuidAt(72));
      expect(second.event).toBeNull();

      expect(sceneEvents(table)).toBe(before);
    } finally {
      table.close();
    }
  });

  it('alors qu’un départ réel en écrit un', () => {
    const table = anAiTable();
    try {
      const before = sceneEvents(table);
      const result = merge(
        table,
        block({ partis: [{ nom: NPC_PRESENT_NAME, cause: 'parti' }] }),
        uuidAt(73),
      );
      expect(result.merge.unchanged).toBe(false);
      expect(result.event?.type).toBe('scene.facts_updated');
      expect(result.seq).toBeGreaterThan(0);
      expect(sceneEvents(table)).toBe(before + 1);

      // ET LA PROJECTION SUIT : le départ est dans l'état rejoué.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.scene?.absent.map((entry) => entry.name).sort()).toEqual(
        [NPC_GONE_NAME, NPC_PRESENT_NAME].sort(),
      );
    } finally {
      table.close();
    }
  });

  it('aucun bloc rendu par le modèle : aucun événement, aucune exception, le tour se termine', () => {
    const table = anAiTable();
    try {
      const before = sceneEvents(table);
      // Les quatre façons dont un modèle gratuit n'écrit pas de bloc, telles
      // que `readSceneBlock` les rend : toutes donnent `null`.
      for (const [index, absent] of [null, null, null, null].entries()) {
        const result = merge(table, absent, uuidAt(80 + index));
        expect(result.event).toBeNull();
        expect(result.merge.rejections).toEqual([]);
        expect(result.merge.unchanged).toBe(true);
      }
      expect(sceneEvents(table)).toBe(before);
      // Le tour se termine : l'état est intact, à l'octet près.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(JSON.stringify(state.scene)).toBe(
        JSON.stringify(loadReplay(table.connection, CAMPAIGN_ID).state.scene),
      );
    } finally {
      table.close();
    }
  });
});

describe('ce que la fusion lit du monde', () => {
  it('connaît les personnages, les entités, les morts et les lieux — et rien de plus', () => {
    const table = anAiTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const view = sceneMergeState(state);

      const dead = view.actors.find((actor) => actor.name === NPC_DEAD_NAME);
      expect(dead?.isDead).toBe(true);
      const present = view.actors.find((actor) => actor.name === NPC_PRESENT_NAME);
      expect(present?.isDead).toBe(false);
      expect(present?.isPlayerCharacter).toBe(false);
      expect(view.actors.find((actor) => actor.name === 'Ashe')?.isPlayerCharacter).toBe(true);
      expect(view.placeIds).toEqual([PLACE_ID]);
      // Le seq de la fusion est CELUI DU PROCHAIN événement, pas celui du
      // dernier : c'est le `sinceSeq` de qui bouge ce tour-ci.
      expect(view.seq).toBe(state.seq + 1);
    } finally {
      table.close();
    }
  });

  it('S3 : le modèle ne fait pas sortir un personnage joueur', () => {
    const table = anAiTable();
    try {
      const result = merge(table, block({ partis: [{ nom: 'Ashe', cause: 'parti' }] }), uuidAt(90));
      expect(result.merge.rejections.map((rejection) => rejection.code)).toContain(
        'pc_removal_attempt',
      );
      expect(result.event).toBeNull();
    } finally {
      table.close();
    }
  });

  it('S4 : une mort que le moteur n’a pas prononcée retombe à « parti »', () => {
    const table = anAiTable();
    try {
      const result = merge(
        table,
        block({ partis: [{ nom: NPC_PRESENT_NAME, cause: 'mort' }] }),
        uuidAt(91),
      );
      expect(result.merge.rejections.map((rejection) => rejection.code)).toContain(
        'death_not_proven',
      );
      expect(
        result.merge.after.absent.find((entry) => entry.name === NPC_PRESENT_NAME)?.cause,
      ).toBe('parti');
    } finally {
      table.close();
    }
  });

  it('S5 : qui est parti ne revient pas par le bloc', () => {
    const table = anAiTable();
    try {
      const result = merge(
        table,
        block({ presents: [{ nom: NPC_GONE_NAME, etat: 'de retour' }] }),
        uuidAt(92),
      );
      expect(result.merge.rejections.map((rejection) => rejection.code)).toContain(
        'absent_reappearance',
      );
      expect(result.event).toBeNull();
    } finally {
      table.close();
    }
  });
});

describe('la scène vide', () => {
  it('une campagne sans scène ouverte fusionne contre une scène vide, sans lever', () => {
    expect(emptyScene(12)).toEqual({
      sceneId: '',
      placeId: '',
      placeName: '',
      timeOfDay: '',
      present: [],
      absent: [],
      updatedSeq: 12,
    });
  });

  it('`sceneBefore` copie les listes, il ne rend pas celles de l’état', () => {
    const table = anAiTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const dto = sceneBefore(state);
      expect(dto.present).not.toBe(state.scene?.present);
      expect(dto.present.map((entry) => entry.name)).toEqual(
        state.scene?.present.map((entry) => entry.name),
      );
    } finally {
      table.close();
    }
  });
});
