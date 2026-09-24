/**
 * Le critère d'acceptation littéral : `aTableState()` passe
 * `zCampaignState.parse` SANS AUCUNE OPTION. Et chaque sous-constructeur passe
 * son propre schéma, sans argument non plus — sinon « valeurs par défaut
 * complètes » ne veut rien dire au premier niveau imbriqué.
 */
import {
  zCampaignSettings,
  zCampaignState,
  zCampaignTruth,
  zChampionLock,
  zClockState,
  zEntityState,
  zProgressTrack,
  zSceneAbsence,
  zScenePresence,
  zSceneState,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { aCharacter } from './characters.js';
import { anId } from './ids.js';
import {
  aCampaignSettings,
  aChampionLock,
  aClock,
  aScene,
  aSceneAbsence,
  aScenePresence,
  aTableState,
  aTrack,
  aTruth,
  aVow,
  anEntity,
} from './table.js';

describe('aTableState', () => {
  it('sans aucune option, passe zCampaignState.parse', () => {
    expect(() => zCampaignState.parse(aTableState())).not.toThrow();
  });

  it('la table par défaut est vide : un personnage, rien d’autre', () => {
    const table = aTableState();

    expect(Object.keys(table.characters)).toHaveLength(1);
    expect(Object.keys(table.tracks)).toHaveLength(0);
    expect(Object.keys(table.clocks)).toHaveLength(0);
    expect(Object.keys(table.entities)).toHaveLength(0);
    expect(table.scene).toBeNull();
    expect(table.seq).toBe(0);
  });

  it('les collections arrivent en tableaux et sortent indexées par leur propre id', () => {
    const deuxieme = aCharacter({ id: anId('character', 2), playerId: anId('player', 2) });
    const table = aTableState({
      characters: [aCharacter(), deuxieme],
      tracks: [aVow()],
      clocks: [aClock()],
      entities: [anEntity()],
      championLocks: [aChampionLock()],
    });

    expect(Object.keys(table.characters)).toStrictEqual([anId('character'), anId('character', 2)]);
    expect(table.characters[anId('character', 2)]).toStrictEqual(deuxieme);
    expect(Object.keys(table.tracks)).toStrictEqual([anId('track')]);
    expect(Object.keys(table.clocks)).toStrictEqual([anId('clock')]);
    expect(Object.keys(table.entities)).toStrictEqual([anId('entity')]);
    expect(Object.keys(table.championLocks)).toStrictEqual(['sejuani']);
    expect(() => zCampaignState.parse(table)).not.toThrow();
  });

  it('la bande se déduit des personnages, et le propriétaire en fait partie', () => {
    const table = aTableState({
      characters: [
        aCharacter(),
        aCharacter({ id: anId('character', 2), playerId: anId('player', 2) }),
      ],
    });

    expect(table.party.memberPlayerIds).toStrictEqual([anId('player'), anId('player', 2)]);
    expect(table.party.memberPlayerIds).toContain(table.party.ownerPlayerId);
  });

  it('une scène ouverte passe encore le schéma', () => {
    expect(() => zCampaignState.parse(aTableState({ scene: aScene() }))).not.toThrow();
  });

  it('deux appels donnent la même table', () => {
    expect(aTableState()).toStrictEqual(aTableState());
  });
});

describe('les sous-constructeurs', () => {
  it('passent chacun leur schéma sans un seul argument', () => {
    expect(() => zCampaignSettings.parse(aCampaignSettings())).not.toThrow();
    expect(() => zProgressTrack.parse(aTrack())).not.toThrow();
    expect(() => zProgressTrack.parse(aVow())).not.toThrow();
    expect(() => zClockState.parse(aClock())).not.toThrow();
    expect(() => zEntityState.parse(anEntity())).not.toThrow();
    expect(() => zChampionLock.parse(aChampionLock())).not.toThrow();
    expect(() => zCampaignTruth.parse(aTruth())).not.toThrow();
    expect(() => zScenePresence.parse(aScenePresence())).not.toThrow();
    expect(() => zSceneAbsence.parse(aSceneAbsence())).not.toThrow();
    expect(() => zSceneState.parse(aScene())).not.toThrow();
  });

  it('aVow impose le genre « vow », même si on tente autre chose', () => {
    expect(aVow({ kind: 'combat' }).kind).toBe('vow');
  });

  it('aScene trie présents et absents par ref.id, comme le prompt l’exige', () => {
    const scene = aScene({
      present: [
        aScenePresence({ ref: { kind: 'character', id: anId('character', 9) }, name: 'Z' }),
        aScenePresence({ ref: { kind: 'character', id: anId('character', 1) }, name: 'A' }),
      ],
      absent: [
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 5) }, name: 'E5' }),
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 2) }, name: 'E2' }),
      ],
    });

    expect(scene.present.map((p) => p.name)).toStrictEqual(['A', 'Z']);
    expect(scene.absent.map((a) => a.name)).toStrictEqual(['E2', 'E5']);
  });
});
