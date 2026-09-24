/**
 * La surface publique. Quatre tâches vont importer ce paquet par son nom : si
 * un outil cesse d'être exporté, elles le découvriraient à la compilation, mais
 * un outil silencieusement ABSENT de l'index se remplace par un doublon local,
 * et c'est ainsi qu'on se retrouve avec deux horloges figées qui divergent.
 */
import { describe, expect, it } from 'vitest';

import * as testkit from './index.js';

const SURFACE = [
  'FIXTURE_ATTRIBUTES',
  'FIXTURE_CHAMPION',
  'FIXTURE_EPOCH',
  'FIXTURE_GAUGES',
  'FIXTURE_MOMENTUM_BOUNDS',
  'FIXTURE_TICK_MS',
  'GOLDEN_UPDATE_ENV',
  'GoldenDirUnusable',
  'GoldenMismatch',
  'GoldenMissing',
  'GoldenSerialisationError',
  'GoldenUpdateMisused',
  'InvalidTableState',
  'JOURNAL_TURN_LENGTH',
  'LONG_CAMPAIGN',
  'LONG_CAMPAIGN_LENGTH',
  'RESERVED_CHAMPIONS',
  'RNG_STREAMS',
  'ReservedChampionMentioned',
  'SEEDS',
  'ScriptedRngExhausted',
  'ScriptedRngOutOfRange',
  'SeqNotContiguous',
  'aCampaignSettings',
  'aChampionLock',
  'aCharacter',
  'aClock',
  'aCorrelationId',
  'aJournal',
  'aScene',
  'aSceneAbsence',
  'aScenePresence',
  'aTableState',
  'aTrack',
  'aTruth',
  'aVow',
  'anEntity',
  'anEvent',
  'anId',
  'counterIds',
  'createCampaignRng',
  'createSeededRng',
  'expectGolden',
  'expectNoReservedChampion',
  'expectSeqContiguous',
  'expectValidState',
  'fixedClock',
  'fixtureCreatedAt',
  'goldenUpdateRequested',
  'normaliseChampionName',
  'reservedChampionNames',
  'scriptedRng',
  'stableStringify',
] as const;

describe('@for/testkit', () => {
  it('expose toute sa boîte à outils depuis un seul point', () => {
    expect(Object.keys(testkit).sort()).toStrictEqual([...SURFACE]);
  });

  it('les trois substituts déterministes se composent', () => {
    const rng = testkit.scriptedRng([4, 2]);
    const horloge = testkit.fixedClock('2024-01-01T00:00:00.000Z');
    const ids = testkit.counterIds('ev');

    const tour = {
      id: ids.next(),
      at: horloge.now(),
      dice: [rng.roll(6), rng.roll(10)],
    };

    expect(testkit.stableStringify(tour)).toBe(
      '{\n  "at": "2024-01-01T00:00:00.000Z",\n  "dice": [\n    4,\n    2\n  ],\n  "id": "ev-1"\n}\n',
    );
  });

  it('les graines nommées sont des chaînes distinctes', () => {
    const graines = Object.values(testkit.SEEDS);

    expect(new Set(graines).size).toBe(graines.length);
    expect(graines.every((graine) => graine.length > 0)).toBe(true);
  });

  it('une graine nommée donne deux fois la même suite', () => {
    const tirages = (): number[] => {
      const rng = testkit.createSeededRng(testkit.SEEDS.default);
      return [rng.roll(6), rng.roll(6), rng.roll(10)];
    };

    expect(tirages()).toStrictEqual(tirages());
  });
});
