/**
 * `<scene_apres>` — F1 → F8 (section 2.3) then S1 → S10 (section 4.7.3).
 *
 * ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
 * In the prototype, an NPC described fleeing after wounding the player came
 * back asleep in his shelter one scene later. Three exchanges were enough.
 * The context was feeding the last journal entries as PROSE, and a model
 * handed a story continues it. Presence facts left prose and became data.
 *
 * ── THE TWO PROPERTIES WORTH READING TWICE ──────────────────────────────────
 * S9: only an explicit mention in `partis` takes somebody out of a scene.
 * Forgetting to copy a name is the commonest failure and must cost nothing.
 * S5: whoever was absent before the turn does not come back through the
 * block. The three legitimate ways back in are all outside the model.
 *
 * ── AND THE ONE THAT MAKES IT SAFE ──────────────────────────────────────────
 * Nothing here throws. An absent, truncated, badly closed or unparsable block
 * returns the previous state TO THE BYTE and the turn ends normally.
 */

import { describe, expect, it } from 'vitest';

import {
  SCENE_CLOSE_TAG,
  SCENE_OPEN_TAG,
  mergeSceneBlock,
  readSceneBlock,
} from '../src/outputs/scene.js';
import { RESERVED, mergeState, sceneAbsence, scenePresence, sceneState } from './fixtures.js';

const wrap = (json: string, prose = 'Tu passes. La glace cède. Rien ne bouge.'): string =>
  `${prose}\n${SCENE_OPEN_TAG}${json}${SCENE_CLOSE_TAG}`;

const MINIMAL = '{}';

// ------------------------------------------------------------------ F1 → F8

describe('la lecture du bloc, F1 → F8', () => {
  it('F1 : zéro balise — bloc absent, prose intacte, tour normal', () => {
    const reading = readSceneBlock('Tu passes. La glace cède.');
    expect(reading).toStrictEqual({
      prose: 'Tu passes. La glace cède.',
      block: null,
      tags: ['scene_block_missing'],
      rejectedBy: 'F1',
    });
  });

  it('F1 : deux balises ouvrantes — bloc ignoré', () => {
    const reading = readSceneBlock(
      `Tu passes.${SCENE_OPEN_TAG}{}${SCENE_CLOSE_TAG}${SCENE_OPEN_TAG}{}`,
    );
    expect(reading.block).toBeNull();
    expect(reading.rejectedBy).toBe('F1');
    expect(reading.prose).toBe('Tu passes.');
  });

  it('F1 : balise mal fermée — bloc ignoré, prose conservée', () => {
    const reading = readSceneBlock(`Tu passes.${SCENE_OPEN_TAG}{"presents":[]`);
    expect(reading.block).toBeNull();
    expect(reading.prose).toBe('Tu passes.');
  });

  it('F2 et F3 : la prose est ce qui précède, le reste est jeté', () => {
    const reading = readSceneBlock(`  Tu passes.  ${SCENE_OPEN_TAG}{}${SCENE_CLOSE_TAG}\nbruit`);
    expect(reading.prose).toBe('Tu passes.');
    expect(reading.block).not.toBeNull();
  });

  it('F4 : au-delà de neuf cents caractères, bloc ignoré', () => {
    const long = `{"lieu":"${'x'.repeat(950)}"}`;
    expect(readSceneBlock(wrap(long)).block).toBeNull();
  });

  it('F5 : JSON invalide, puis JSON valide hors schéma — bloc ignoré', () => {
    expect(readSceneBlock(wrap('{pas du json')).block).toBeNull();
    expect(readSceneBlock(wrap('{"inconnu":1}')).block).toBeNull();
    expect(readSceneBlock(wrap('{"partis":[{"nom":"Keld","cause":"enfui"}]}')).block).toBeNull();
  });

  it('F5 : un bloc minimal parse — « rien n’a changé » n’est pas une erreur', () => {
    expect(readSceneBlock(wrap(MINIMAL)).block).toStrictEqual({
      lieu: '',
      presents: [],
      partis: [],
      refus: null,
    });
  });

  it('F6 : un chiffre vide l’état, retire l’entrée nommée, annule le refus', () => {
    const reading = readSceneBlock(
      wrap(
        '{"lieu":"col 2","presents":[{"nom":"Ulrun","etat":"blessé à 3 doigts"},{"nom":"Keld 2","etat":""}],' +
          '"refus":{"cause":"cible_morte","cible":"Keld 2"}}',
      ),
    );
    expect(reading.block).toStrictEqual({
      lieu: '',
      presents: [{ nom: 'Ulrun', etat: '' }],
      partis: [],
      refus: null,
    });
  });

  it('F7 : un terme de règle dans etat le vide, sans toucher au reste', () => {
    const reading = readSceneBlock(
      wrap('{"presents":[{"nom":"Ulrun","etat":"sa vigueur baisse"}]}'),
    );
    expect(reading.block?.presents).toStrictEqual([{ nom: 'Ulrun', etat: '' }]);
  });

  it('F8 : un champion réservé coule tout le bloc et lève l’alerte', () => {
    const reading = readSceneBlock(
      wrap('{"presents":[{"nom":"Lissandra","etat":"debout"}]}'),
      RESERVED,
    );
    expect(reading.block).toBeNull();
    expect(reading.tags).toStrictEqual(['reserved_champion_leak']);
    expect(reading.rejectedBy).toBe('F8');
  });

  it('et sans liste de réservés, F8 ne garde rien — dit plutôt que supposé', () => {
    expect(
      readSceneBlock(wrap('{"presents":[{"nom":"Lissandra","etat":""}]}')).block,
    ).not.toBeNull();
  });

  it('aucune de ces entrées ne lève', () => {
    for (const input of [
      '',
      'prose seule',
      SCENE_OPEN_TAG,
      SCENE_CLOSE_TAG,
      wrap('null'),
      wrap('[]'),
      wrap('{'),
      `${SCENE_CLOSE_TAG}avant${SCENE_OPEN_TAG}`,
    ]) {
      expect(() => readSceneBlock(input, RESERVED)).not.toThrow();
    }
  });
});

// ----------------------------------------------------------------- S1 → S10

describe('la fusion, S1 → S10', () => {
  const before = sceneState();
  const state = mergeState();

  it('S1 : un nom que rien n’apparie est ignoré', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [{ nom: 'Fjolnir', etat: 'debout' }], partis: [], refus: null },
      state,
    );
    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      'scene_name_unknown',
    ]);
    expect(result.after.present.map((entry) => entry.name)).not.toContain('Fjolnir');
  });

  it('S2 : deux homonymes hors scène rendent le nom ambigu, donc ignoré', () => {
    const twin = { ...state.actors[5]!, ref: { kind: 'entity' as const, id: 'ent_hreidar2' } };
    const ambiguous = mergeState({ actors: [...state.actors, twin] });
    const scene = sceneState({ present: [scenePresence('chr_sejuani', 'Sejuani', 'debout')] });
    const result = mergeSceneBlock(
      scene,
      { lieu: '', presents: [{ nom: 'Hreidar', etat: 'debout' }], partis: [], refus: null },
      ambiguous,
    );
    expect(result.rejections.map((rejection) => rejection.rule)).toStrictEqual(['S2']);
  });

  /**
   * S1's own wording: « sur la scène courante PUIS sur `entities` ». A homonym
   * outside the scene does not make the one IN the scene ambiguous — otherwise
   * the commonest case, a second NPC sharing a first name somewhere in the
   * campaign, would freeze every merge.
   */
  it('S1 : mais un homonyme hors scène ne rend pas ambigu celui qui y est', () => {
    const twin = { ...state.actors[2]!, ref: { kind: 'entity' as const, id: 'ent_ulrun2' } };
    const result = mergeSceneBlock(
      before,
      {
        lieu: '',
        presents: [{ nom: 'Ulrun', etat: 'debout, la corde en main' }],
        partis: [],
        refus: null,
      },
      mergeState({ actors: [...state.actors, twin] }),
    );
    expect(result.rejections).toStrictEqual([]);
    expect(result.after.present.find((entry) => entry.ref.id === 'ent_ulrun')?.state).toBe(
      'debout, la corde en main',
    );
  });

  it('S3 : un personnage joueur placé dans partis est ignoré', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [], partis: [{ nom: 'Sejuani', cause: 'parti' }], refus: null },
      state,
    );
    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      'pc_removal_attempt',
    ]);
    expect(result.after.present.map((entry) => entry.name)).toContain('Sejuani');
    expect(result.after.absent.map((entry) => entry.name)).not.toContain('Sejuani');
  });

  it('S4 : une mort que le journal ne prouve pas est ramenée à « parti »', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [], partis: [{ nom: 'Ulrun', cause: 'mort' }], refus: null },
      state,
    );
    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      'death_not_proven',
    ]);
    expect(result.after.absent.find((entry) => entry.name === 'Ulrun')?.cause).toBe('parti');
  });

  it('S4 : et une mort que le moteur a écrite est retenue', () => {
    const scene = sceneState({ absent: [] });
    const result = mergeSceneBlock(
      scene,
      { lieu: '', presents: [], partis: [{ nom: 'Keld', cause: 'mort' }], refus: null },
      state,
    );
    expect(result.rejections).toStrictEqual([]);
    expect(result.after.absent.find((entry) => entry.name === 'Keld')?.cause).toBe('mort');
  });

  it('S5 : un parti que le bloc remet en scène est ignoré', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [{ nom: 'Keld', etat: 'debout' }], partis: [], refus: null },
      state,
    );
    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      'absent_reappearance',
    ]);
    expect(result.after.present.map((entry) => entry.name)).not.toContain('Keld');
    expect(result.after.absent.map((entry) => entry.name)).toContain('Keld');
  });

  it('S6 : un lieu inconnu est ignoré, un lieu connu déplace la scène', () => {
    const unknown = mergeSceneBlock(
      before,
      { lieu: 'nulle_part', presents: [], partis: [], refus: null },
      state,
    );
    expect(unknown.after.placeId).toBe(before.placeId);
    expect(unknown.rejections.map((rejection) => rejection.rule)).toStrictEqual(['S6']);

    const known = mergeSceneBlock(
      before,
      { lieu: 'vallee_basse', presents: [], partis: [], refus: null },
      state,
    );
    expect(known.after.placeId).toBe('vallee_basse');
  });

  /**
   * S7 — and the fixture has TWO entries in a NON-NATURAL order, because a
   * criterion that speaks of ordering cannot be held by a sorted fixture.
   */
  it('S7 : au-delà de huit présents, on garde les plus récents, puis l’id', () => {
    const many = Array.from({ length: 10 }, (_unused, index) =>
      scenePresence(`ent_p${String(9 - index)}`, `P${String(9 - index)}`, '', 100 - index),
    );
    const scene = sceneState({ present: many.slice(0, 8), absent: [] });
    const actors = many.map((entry) => ({
      ref: entry.ref,
      name: entry.name,
      isPlayerCharacter: false,
      isDead: false,
      placeId: 'col_des_hurleurs',
    }));
    const result = mergeSceneBlock(
      scene,
      {
        lieu: '',
        presents: many.slice(8).map((entry) => ({ nom: entry.name, etat: '' })),
        partis: [],
        refus: null,
      },
      mergeState({ actors }),
    );
    expect(result.after.present).toHaveLength(8);
    expect(result.rejections.map((rejection) => rejection.rule)).toContain('S7');
    // Stored sorted by `ref.id`, whatever the insertion order.
    expect(result.after.present.map((entry) => entry.ref.id)).toStrictEqual(
      [...result.after.present.map((entry) => entry.ref.id)].sort(),
    );
  });

  it('S8 : le nom est toujours celui de la projection, jamais celui du modèle', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [{ nom: 'ULRUN', etat: 'debout' }], partis: [], refus: null },
      state,
    );
    expect(result.after.present.find((entry) => entry.ref.id === 'ent_ulrun')?.name).toBe('Ulrun');
  });

  /**
   * S9, THE ONE TO READ TWICE. Forgetting a name is the commonest failure of
   * a model, and it must cost nothing.
   */
  it('S9 : une personne présente et absente des deux listes reste présente', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [{ nom: 'Sejuani', etat: 'debout' }], partis: [], refus: null },
      state,
    );
    expect(result.after.present.map((entry) => entry.name).sort()).toStrictEqual([
      'Hreidar',
      'Sejuani',
      'Ulrun',
    ]);
    expect(result.rejections).toStrictEqual([]);
  });

  it('S10 : la fusion ne rend qu’un état de scène — garanti par le type', () => {
    const result = mergeSceneBlock(
      before,
      { lieu: '', presents: [], partis: [], refus: null },
      state,
    );
    expect(Object.keys(result.after).sort()).toStrictEqual(
      ['absent', 'placeId', 'placeName', 'present', 'sceneId', 'timeOfDay', 'updatedSeq'].sort(),
    );
  });

  it('un bloc nul rend l’état précédent à l’octet près, sans lever', () => {
    const result = mergeSceneBlock(before, null, state);
    expect(result.after).toBe(before);
    expect(result.unchanged).toBe(true);
  });

  /**
   * Section 4.7.1: the journal entry is only written when the merge changed
   * something. On the demonstration campaign that is roughly one turn in
   * three, and a merge that always reported a change would write an event
   * every turn — the cost this rule exists to avoid.
   */
  it('et un bloc qui ne change rien ne produit aucun changement', () => {
    const same = mergeSceneBlock(
      before,
      {
        lieu: '',
        presents: before.present.map((entry) => ({ nom: entry.name, etat: entry.state })),
        partis: before.absent.map((entry) => ({ nom: entry.name, cause: entry.cause })),
        refus: null,
      },
      state,
    );
    expect(same.unchanged).toBe(true);
    expect(same.after).toBe(before);
  });

  it('alors qu’un départ réel, lui, est un changement', () => {
    const moved = mergeSceneBlock(
      before,
      { lieu: '', presents: [], partis: [{ nom: 'Ulrun', cause: 'parti' }], refus: null },
      state,
    );
    expect(moved.unchanged).toBe(false);
    expect(moved.after.updatedSeq).toBe(state.seq);
  });

  /**
   * TWO ACTORS RATHER THAN ONE (RECETTE section 5 bis). One departure and one
   * arrival in the SAME block: a merge that handled `presents` after `partis`
   * — or that shared one map — would lose one of the two silently.
   */
  it('un départ et une arrivée dans le même bloc sont tous deux appliqués', () => {
    const scene = sceneState({
      present: [scenePresence('ent_ulrun', 'Ulrun', 'assis')],
      absent: [sceneAbsence('ent_keld', 'Keld', 'mort')],
    });
    const result = mergeSceneBlock(
      scene,
      {
        lieu: '',
        presents: [{ nom: 'Hreidar', etat: 'à la corde' }],
        partis: [{ nom: 'Ulrun', cause: 'parti' }],
        refus: null,
      },
      state,
    );
    expect(result.after.present.map((entry) => entry.name)).toStrictEqual(['Hreidar']);
    expect(result.after.absent.map((entry) => entry.name).sort()).toStrictEqual(['Keld', 'Ulrun']);
  });
});
