import {
  aCharacter,
  aClock,
  aScene,
  aSceneAbsence,
  aScenePresence,
  aTableState,
  aTrack,
  anId,
} from '@for/testkit';
import { describe, expect, it } from 'vitest';

import { SCENE_PRESENCE_MAX, checkInvariants, isConsistent } from './index.js';

const HERO = anId('character');

describe('a state that holds together', () => {
  it('reports nothing on a table straight out of the builder', () => {
    expect(checkInvariants(aTableState())).toEqual([]);
    expect(isConsistent(aTableState())).toBe(true);
  });

  it('reports nothing on a state with a scene, a track and a clock', () => {
    const state = aTableState({
      tracks: [aTrack()],
      clocks: [aClock()],
      scene: aScene(),
    });
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('a state that does not', () => {
  it('names a gauge outside its range', () => {
    const state = aTableState({
      characters: [aCharacter({ id: HERO, gauges: { vigueur: 9, ame: 5, vivres: 5 } })],
    });
    expect(checkInvariants(state).map((violation) => violation.code)).toEqual([
      'gauge_out_of_range',
    ]);
  });

  it('names momentum outside the character own bounds', () => {
    const state = aTableState({ characters: [aCharacter({ id: HERO, momentum: 99 })] });
    expect(checkInvariants(state)[0]?.details['gauge']).toBe('momentum');
  });

  it('names a collection keyed under somebody else identifier', () => {
    const wrong = aTableState();
    const mislabelled = {
      ...wrong,
      characters: { [anId('character', 7)]: aCharacter({ id: HERO }) },
    };
    expect(checkInvariants(mislabelled).map((violation) => violation.code)).toEqual([
      'unknown_character',
    ]);
  });

  it('names a track keyed wrong, and a tick count out of range', () => {
    const track = aTrack({ ticks: 99 });
    const state = {
      ...aTableState(),
      tracks: { [anId('track', 7)]: track },
    };
    expect(checkInvariants(state).map((violation) => violation.code)).toEqual([
      'unknown_track',
      'gauge_out_of_range',
    ]);
  });

  it('names a clock keyed wrong, and more segments filled than it has', () => {
    const clock = aClock({ segments: 4, filled: 9 });
    const state = { ...aTableState(), clocks: { [anId('clock', 7)]: clock } };
    expect(checkInvariants(state).map((violation) => violation.code)).toEqual([
      'unknown_clock',
      'gauge_out_of_range',
    ]);
  });

  it('names a scene list over its cap, both ways', () => {
    const tooMany = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_value, index) =>
      aScenePresence({ ref: { kind: 'entity', id: anId('entity', index + 1) } }),
    );
    const tooGone = Array.from({ length: SCENE_PRESENCE_MAX + 1 }, (_value, index) =>
      aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', index + 20) } }),
    );
    const state = aTableState({ scene: aScene({ present: tooMany, absent: tooGone }) });
    expect(checkInvariants(state).map((violation) => violation.code)).toEqual([
      'scene_capacity_exceeded',
      'scene_capacity_exceeded',
    ]);
  });

  it('names a scene list that is not sorted by ref.id', () => {
    const scene = aScene({ present: [aScenePresence()] });
    const unsorted = {
      ...scene,
      present: [
        aScenePresence({ ref: { kind: 'entity', id: anId('entity', 2) } }),
        aScenePresence({ ref: { kind: 'entity', id: anId('entity', 1) } }),
      ],
      absent: [
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 4) } }),
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 3) } }),
      ],
    };
    const state = aTableState({ scene: unsorted });
    expect(checkInvariants(state).map((violation) => violation.code)).toEqual([
      'target_not_present',
      'target_not_present',
    ]);
    expect(isConsistent(state)).toBe(false);
  });

  it('says nothing about two lists that ARE sorted, entry by entry', () => {
    // The other half of the proof: the test above shows the detection bites
    // on a reversed list, this one shows it stays quiet on a sorted one. With
    // a single entry per list neither direction is measurable, since a list
    // of length one is sorted whatever the comparison does.
    const state = aTableState({
      scene: aScene({
        present: [
          aScenePresence({ ref: { kind: 'entity', id: anId('entity', 1) } }),
          aScenePresence({ ref: { kind: 'entity', id: anId('entity', 2) } }),
        ],
        absent: [
          aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 3) } }),
          aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 4) } }),
        ],
      }),
    });
    expect(state.scene?.present.map((entry) => entry.ref.id)).toEqual([
      anId('entity', 1),
      anId('entity', 2),
    ]);
    expect(checkInvariants(state)).toEqual([]);
    expect(isConsistent(state)).toBe(true);
  });

  it('says nothing about the order of a list with one entry, or none', () => {
    expect(checkInvariants(aTableState({ scene: aScene({ present: [], absent: [] }) }))).toEqual(
      [],
    );
  });
});
