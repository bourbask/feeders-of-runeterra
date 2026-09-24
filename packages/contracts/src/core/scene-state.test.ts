import { describe, expect, it } from 'vitest';

import {
  SCENE_NAME_MAX,
  SCENE_PRESENCE_MAX,
  SCENE_PRESENCE_STATE_MAX,
  zSceneAbsence,
  zScenePresence,
  zSceneState,
} from './scene-state.js';

const ulid = (n: number): string => `0${String(n).padStart(25, '0')}`;

const presence = (n: number) => ({
  ref: { kind: 'character' as const, id: ulid(n) },
  name: `Personnage ${String(n)}`,
  state: 'debout',
  sinceSeq: 1,
});

const absence = (n: number, cause = 'parti') => ({
  ref: { kind: 'entity' as const, id: ulid(n) },
  name: `Entité ${String(n)}`,
  cause,
  sinceSeq: 1,
});

const scene = (over: Record<string, unknown> = {}) => ({
  sceneId: ulid(1),
  placeId: 'col-de-givre',
  placeName: 'Le col de givre',
  timeOfDay: 'crépuscule',
  present: [presence(2)],
  absent: [absence(3)],
  updatedSeq: 4,
  ...over,
});

describe('zSceneState — les bornes de l’état de scène', () => {
  it('accepte huit présents', () => {
    const present = Array.from({ length: SCENE_PRESENCE_MAX }, (_, i) => presence(i + 10));
    expect(zSceneState.safeParse(scene({ present })).success).toBe(true);
  });

  it('refuse neuf présents', () => {
    const present = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_, i) => presence(i + 10));
    expect(zSceneState.safeParse(scene({ present })).success).toBe(false);
  });

  it('refuse neuf partis', () => {
    const absent = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_, i) => absence(i + 10));
    expect(zSceneState.safeParse(scene({ absent })).success).toBe(false);
  });

  it.each(['parti', 'mort', 'hors_de_portee'])('accepte la cause d’absence « %s »', (cause) => {
    expect(zSceneAbsence.safeParse(absence(5, cause)).success).toBe(true);
  });

  it.each(['fui', 'endormi', 'absent', 'PARTI', ''])(
    'refuse la cause d’absence « %s »',
    (cause) => {
      expect(zSceneAbsence.safeParse(absence(5, cause)).success).toBe(false);
    },
  );

  it('refuse un nom de plus de 40 caractères', () => {
    const tooLong = { ...presence(2), name: 'a'.repeat(SCENE_NAME_MAX + 1) };
    expect(zScenePresence.safeParse(tooLong).success).toBe(false);
  });

  it('refuse un état de présence de plus de 60 caractères', () => {
    const tooLong = { ...presence(2), state: 'a'.repeat(SCENE_PRESENCE_STATE_MAX + 1) };
    expect(zScenePresence.safeParse(tooLong).success).toBe(false);
  });

  it('accepte une scène vide de présents comme de partis', () => {
    expect(zSceneState.safeParse(scene({ present: [], absent: [] })).success).toBe(true);
  });

  it('refuse une référence de scène d’un genre inconnu', () => {
    const wrong = { ...presence(2), ref: { kind: 'clock', id: ulid(9) } };
    expect(zScenePresence.safeParse(wrong).success).toBe(false);
  });
});
