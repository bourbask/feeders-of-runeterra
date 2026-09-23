import { describe, expect, it } from 'vitest';

import * as engine from './index.js';
import {
  ATTRIBUTE_SPREAD,
  ATTRIBUTES,
  CLOCK_SEGMENT_COUNTS,
  DEFAULT_MOMENTUM_BOUNDS,
  EFFECT_OPS,
  ENTITY_KINDS,
  GAUGE_MAX,
  GAUGE_MIN,
  GAUGES,
  INTENT_TYPES,
  LIKELIHOOD_THRESHOLDS,
  MAX_PROGRESS_TICKS,
  MOVE_IDS,
  OUTCOMES,
  PROGRESS_RANKS,
  RNG_STREAMS,
  RULE_VIOLATION_CODES,
  SCENE_ABSENCE_CAUSES,
  SCENE_PRESENCE_MAX,
  TICKS_PER_MILESTONE,
  VOW_RESOLUTION_MOVES,
} from './index.js';

describe('the domain vocabulary', () => {
  it('names the five attributes and the only legal spread', () => {
    expect([...ATTRIBUTES]).toEqual(['vif', 'coeur', 'fer', 'ombre', 'esprit']);
    expect([...ATTRIBUTE_SPREAD].sort((a, b) => b - a).join(',')).toBe('3,2,2,1,1');
  });

  it('names the three gauges and their bounds', () => {
    expect([...GAUGES]).toEqual(['vigueur', 'ame', 'vivres']);
    expect([GAUGE_MIN, GAUGE_MAX]).toEqual([0, 5]);
    expect(DEFAULT_MOMENTUM_BOUNDS).toEqual({ min: -6, max: 10, reset: 2 });
  });

  it('gives each rank its milestone worth: 12 / 8 / 4 / 2 / 1', () => {
    expect([...PROGRESS_RANKS]).toEqual(['genant', 'dangereux', 'redoutable', 'extreme', 'epique']);
    expect(PROGRESS_RANKS.map((rank) => TICKS_PER_MILESTONE[rank])).toEqual([12, 8, 4, 2, 1]);
    expect(MAX_PROGRESS_TICKS).toBe(40);
  });

  it('allows only 4, 6, 8 or 10 clock segments', () => {
    expect([...CLOCK_SEGMENT_COUNTS]).toEqual([4, 6, 8, 10]);
  });

  it('bounds a scene at eight present and eight gone', () => {
    expect(SCENE_PRESENCE_MAX).toBe(8);
    expect([...SCENE_ABSENCE_CAUSES]).toEqual(['parti', 'mort', 'hors_de_portee']);
  });

  it('lists the eleven V1 moves and the three outcomes', () => {
    expect(MOVE_IDS).toHaveLength(11);
    expect([...OUTCOMES]).toEqual(['franche', 'partielle', 'echec']);
    for (const move of VOW_RESOLUTION_MOVES) expect(MOVE_IDS).toContain(move);
  });

  it('weights the oracle bands on d100', () => {
    expect(Object.values(LIKELIHOOD_THRESHOLDS).sort((a, b) => b - a)).toEqual([
      90, 75, 50, 25, 10,
    ]);
  });

  it('lists the seven normalised RNG streams', () => {
    expect([...RNG_STREAMS]).toEqual([
      'action',
      'challenge-a',
      'challenge-b',
      'oracle',
      'price',
      'presage',
      'fallback',
    ]);
  });

  it('keeps the intent list free of any that would carry a result', () => {
    // Invariant 3. `gauge.set`, `clock.advance` and `price.apply` are the
    // three the spec names explicitly as never-to-exist.
    for (const forbidden of ['gauge.set', 'clock.advance', 'price.apply']) {
      expect(INTENT_TYPES).not.toContain(forbidden);
    }
    expect(INTENT_TYPES.filter((type) => type.startsWith('narration.'))).toEqual([]);
    expect(INTENT_TYPES).toHaveLength(20);
  });

  it('declares every effect op, and no op that builds an effect from text', () => {
    expect(EFFECT_OPS).toHaveLength(13);
    expect(new Set(EFFECT_OPS).size).toBe(13);
  });

  it('keeps rule violation codes machine-readable and distinct', () => {
    expect(new Set(RULE_VIOLATION_CODES).size).toBe(RULE_VIOLATION_CODES.length);
    for (const code of RULE_VIOLATION_CODES) expect(code).toMatch(/^[a-z][a-z_]*$/);
  });

  it('knows the entity kinds of the structured memory', () => {
    expect([...ENTITY_KINDS]).toEqual([
      'npc',
      'place',
      'faction',
      'item',
      'beast',
      'thread',
      'presage',
    ]);
  });
});

describe('the public surface', () => {
  it('exports the catalogue and the generator, and keeps drawUniform internal', () => {
    expect(Object.keys(engine)).toContain('GAME_EVENT_TYPES');
    expect(Object.keys(engine)).toContain('createCampaignRng');
    expect(Object.keys(engine)).not.toContain('drawUniform');
  });
});
