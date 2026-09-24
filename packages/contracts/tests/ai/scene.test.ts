/**
 * `SceneBlockSchema` — the four refusals and the one acceptance the M0-12
 * acceptance criteria name, plus the bounds.
 *
 * The acceptance is the one that matters most: a MINIMAL BLOCK IS NEVER AN
 * ERROR. Section 2.3 F5 says an absent or malformed block keeps the previous
 * scene state to the byte and the turn ends normally; a schema that refused
 * `{}` would turn "the model had nothing to report" into a failed turn, and
 * this mechanism would then be able to degrade availability.
 */
import { SCENE_ABSENCE_CAUSES, SCENE_PRESENCE_MAX } from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  SCENE_BLOCK_DEPARTURE_CAUSES,
  SCENE_BLOCK_TEXT_MAX,
  SCENE_REFUSAL_CAUSES,
  SceneBlockSchema,
} from '../../src/ai/scene.js';
import { SCENE_NAME_MAX } from '../../src/core/scene-state.js';

const present = (nom: string) => ({ nom, etat: '' });

describe('SceneBlockSchema', () => {
  // ÉPINGLÉ EN TOUTES LETTRES. Les bornes viennent de `core/scene-state.ts`,
  // qui les mirroite du moteur — mais un test qui borne avec la constante
  // qu'il vérifie reste vert quand on déplace la constante. Mesuré sur le
  // plafond de la chronique, corrigé partout.
  it('les bornes de la §2.3 valent 8, 40 et 60', () => {
    expect([SCENE_PRESENCE_MAX, SCENE_NAME_MAX, SCENE_BLOCK_TEXT_MAX]).toStrictEqual([8, 40, 60]);
  });

  it('accepte un bloc où presents, partis, lieu et refus sont TOUS absents (F5)', () => {
    const parsed = SceneBlockSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data).toStrictEqual({ lieu: '', presents: [], partis: [], refus: null });
  });

  it('refuse une neuvième entrée dans presents', () => {
    const nine = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_, i) => present(`n${String(i)}`));
    expect(SceneBlockSchema.safeParse({ presents: nine }).success).toBe(false);
    expect(
      SceneBlockSchema.safeParse({ presents: nine.slice(0, SCENE_PRESENCE_MAX) }).success,
    ).toBe(true);
  });

  it('refuse une neuvième entrée dans partis', () => {
    const nine = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_, i) => ({
      nom: `n${String(i)}`,
      cause: 'parti' as const,
    }));
    expect(SceneBlockSchema.safeParse({ partis: nine }).success).toBe(false);
  });

  it('refuse une cause de refus hors des quatre valeurs closes', () => {
    for (const cause of SCENE_REFUSAL_CAUSES) {
      expect(SceneBlockSchema.safeParse({ refus: { cause, cible: 'Katla' } }).success).toBe(true);
    }
    expect(
      SceneBlockSchema.safeParse({ refus: { cause: 'ca_me_plait_pas', cible: 'Katla' } }).success,
    ).toBe(false);
    // Ce qui n'est JAMAIS une cause (§4.8.1) : le résultat déplaît, l'action
    // est risquée, stupide, immorale ou absurde. Aucune n'a de valeur ici, et
    // c'est la frontière entre « matériellement impossible » et « je n'aime
    // pas l'issue » — l'issue est déjà tranchée par le moteur.
    expect(SCENE_REFUSAL_CAUSES).toHaveLength(4);
  });

  it('refuse une clé inconnue (.strict()), à tous les niveaux', () => {
    expect(SceneBlockSchema.safeParse({ inconnu: 1 }).success).toBe(false);
    expect(SceneBlockSchema.safeParse({ presents: [{ nom: 'Katla', pv: 3 }] }).success).toBe(false);
    expect(
      SceneBlockSchema.safeParse({ refus: { cause: 'cible_morte', cible: 'x', seq: 12 } }).success,
    ).toBe(false);
  });

  it('refuse un nom au-delà de 40 caractères et un etat au-delà de 60', () => {
    expect(
      SceneBlockSchema.safeParse({ presents: [present('a'.repeat(SCENE_NAME_MAX))] }).success,
    ).toBe(true);
    expect(
      SceneBlockSchema.safeParse({ presents: [present('a'.repeat(SCENE_NAME_MAX + 1))] }).success,
    ).toBe(false);
    expect(
      SceneBlockSchema.safeParse({
        presents: [{ nom: 'Katla', etat: 'a'.repeat(SCENE_BLOCK_TEXT_MAX + 1) }],
      }).success,
    ).toBe(false);
  });

  it('refuse un lieu et une cible au-delà de 60 caractères', () => {
    expect(SceneBlockSchema.safeParse({ lieu: 'a'.repeat(SCENE_BLOCK_TEXT_MAX) }).success).toBe(
      true,
    );
    expect(SceneBlockSchema.safeParse({ lieu: 'a'.repeat(SCENE_BLOCK_TEXT_MAX + 1) }).success).toBe(
      false,
    );
    expect(
      SceneBlockSchema.safeParse({
        refus: { cause: 'cible_absente', cible: 'a'.repeat(SCENE_BLOCK_TEXT_MAX + 1) },
      }).success,
    ).toBe(false);
  });

  it('refuse un nom vide : une entrée sans nom ne s’apparie à rien', () => {
    expect(SceneBlockSchema.safeParse({ presents: [present('')] }).success).toBe(false);
  });

  it('ne porte AUCUN champ mécanique : quatre clés, et ce sont celles-là', () => {
    // Le garde-fou de l'invariant 1 sur la sortie du modèle. Une jauge, une
    // issue, un dé ou un `eventSeq` ici et le conteur redeviendrait décideur.
    expect(Object.keys(SceneBlockSchema.shape).sort()).toStrictEqual([
      'lieu',
      'partis',
      'presents',
      'refus',
    ]);
  });

  it('les causes de départ suivent encore celles du moteur (dérive mesurée)', () => {
    // Elles coïncident aujourd'hui. Le test existe pour que la coïncidence
    // reste mesurée : le jour où le moteur en ajoute une, c'est une DÉCISION
    // d'élargir ce que le conteur a le droit de rapporter, pas un effet de bord.
    expect([...SCENE_BLOCK_DEPARTURE_CAUSES]).toStrictEqual([...SCENE_ABSENCE_CAUSES]);
  });
});
