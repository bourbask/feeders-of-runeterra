/**
 * The registry, and the three lines every handler shares.
 *
 * `MOVE_REGISTRY` is guarded by its type in one direction and `MOVE_BY_INTENT`
 * in the other, but neither can say that the handler behind a key is the
 * handler that key names. That pairing is checked here, at runtime, because
 * there is no other way to check it.
 */

import { aCharacter, aTableState, anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { MoveIntent } from '../../src/index.js';
import {
  GATHER_INFORMATION_ATTRIBUTE,
  HARM_GAUGE,
  INTENT_TYPES,
  MOVE_BY_INTENT,
  MOVE_IDS,
  MOVE_REGISTRY,
  bonusOf,
  chooseAttribute,
  harmAmount,
  isErr,
  isOk,
  planOf,
  requireOpenVow,
} from '../../src/index.js';
import { aContent } from '../support/engine-content.test.js';

const HERO = anId('character');
const TRACK = anId('track');
const content = aContent();

describe('MOVE_REGISTRY', () => {
  it('holds one handler per move identifier, and each one knows its own name', () => {
    expect(Object.keys(MOVE_REGISTRY).sort()).toEqual([...MOVE_IDS].sort());
    for (const id of MOVE_IDS) {
      expect(MOVE_REGISTRY[id].id).toBe(id);
    }
  });

  it('reaches every move.* intent, and each handler answers the one that reaches it', () => {
    const moveIntents = INTENT_TYPES.filter((type) => type.startsWith('move.'));
    expect(moveIntents).toHaveLength(MOVE_IDS.length);
    for (const type of moveIntents) {
      const handler = MOVE_BY_INTENT[type as MoveIntent['type']];
      expect(handler.intentType).toBe(type);
      expect(MOVE_REGISTRY[handler.id]).toBe(handler);
    }
  });

  it('is a bijection: no two intents share a handler', () => {
    expect(new Set(Object.values(MOVE_BY_INTENT)).size).toBe(MOVE_IDS.length);
  });
});

describe('the shared helpers', () => {
  const definition = content.moves['face-danger']!;

  it('takes the attribute the player named when the move offers it', () => {
    const chosen = chooseAttribute(definition, 'ombre');
    expect(isOk(chosen) && chosen.value).toBe('ombre');
  });

  it('refuses one the move does not offer', () => {
    const chosen = chooseAttribute(content.moves.strike!, 'ombre');
    expect(isErr(chosen) && chosen.error.code).toBe('attribute_not_allowed');
  });

  it('falls back to the FIRST attribute the content lists', () => {
    const chosen = chooseAttribute(content.moves['endure-cold']!, undefined);
    expect(isOk(chosen) && chosen.value).toBe('fer');
  });

  it('refuses when the content lists none at all', () => {
    const chosen = chooseAttribute({ ...definition, attributeOptions: [] }, undefined);
    expect(isErr(chosen) && chosen.error.code).toBe('unknown_move');
  });

  it('reads an absent bonus as none', () => {
    expect(bonusOf({})).toBe(0);
    expect(bonusOf({ bonus: -2 })).toBe(-2);
    expect(bonusOf({ bonus: undefined })).toBe(0);
  });

  it('builds a plan whose optional parts are all empty', () => {
    const plan = planOf({ kind: 'none', outcome: 'franche' }, 'texte');
    expect(plan).toEqual({
      roll: { kind: 'none', outcome: 'franche' },
      narrativeInput: 'texte',
      trackId: null,
      playerRank: null,
      trackTitle: '',
      upfrontEffects: [],
      resolution: { franche: null, partielle: null, echec: null },
    });
  });

  it('brings harm back to something a gauge can take', () => {
    expect(harmAmount(undefined)).toBe(1);
    expect(harmAmount(3)).toBe(3);
    expect(harmAmount(-4)).toBe(0);
    expect(harmAmount(2.7)).toBe(2);
    expect(harmAmount(Number.NaN)).toBe(1);
    expect(HARM_GAUGE).toBe('vigueur');
  });

  it('forces esprit on gather-information', () => {
    expect(GATHER_INFORMATION_ATTRIBUTE).toBe('esprit');
  });
});

describe('requireOpenVow, in its three refusals and its one success', () => {
  const track = {
    id: TRACK,
    kind: 'vow' as const,
    rank: 'dangereux' as const,
    title: '',
    description: '',
    ownerCharacterId: null,
    ticks: 0,
    status: 'open' as const,
    visibility: 'public' as const,
    tags: [],
    createdSeq: 1,
    updatedSeq: 1,
    resolvedSeq: null,
  };
  const state = (tracks: (typeof track)[]) =>
    aTableState({ characters: [aCharacter({ id: HERO })], tracks });

  it('returns the vow when it is open', () => {
    const found = requireOpenVow(state([track]), TRACK);
    expect(isOk(found) && found.value.id).toBe(TRACK);
  });

  it('refuses a track nobody opened', () => {
    const found = requireOpenVow(state([]), TRACK);
    expect(isErr(found) && found.error.code).toBe('unknown_track');
  });

  it('refuses a track that is not a vow', () => {
    const found = requireOpenVow(state([{ ...track, kind: 'combat' as never }]), TRACK);
    expect(isErr(found) && found.error.code).toBe('track_wrong_kind');
  });

  it('refuses a vow already closed', () => {
    const found = requireOpenVow(state([{ ...track, status: 'forsaken' as never }]), TRACK);
    expect(isErr(found) && found.error.code).toBe('track_already_resolved');
  });
});
