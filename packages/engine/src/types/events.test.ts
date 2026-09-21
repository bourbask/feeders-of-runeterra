import { describe, expect, it } from 'vitest';

import {
  ACTOR_KINDS,
  ENGINE_ONLY_EVENT_TYPES,
  GAME_EVENT_TYPES,
  GM_PROPOSAL_KINDS,
  type GameEvent,
} from './events.js';

describe('the event catalogue', () => {
  it('holds exactly 71 types, all distinct', () => {
    expect(GAME_EVENT_TYPES).toHaveLength(71);
    expect(new Set(GAME_EVENT_TYPES).size).toBe(71);
  });

  it('groups them in the order of the catalogue of record', () => {
    // Families in the order of 03-donnees.md section 3.4. A type inserted in
    // the wrong family shows up here rather than in a review three weeks on.
    const families = GAME_EVENT_TYPES.map((type) => type.replace(/\..*$/, ''));
    const firstAppearance = [...new Set(families)];
    expect(firstAppearance).toEqual([
      'campaign',
      'party',
      'character',
      'roll',
      'move',
      'track',
      'clock',
      'scene',
      'narration',
      'entity',
      'session',
      'chronicle',
      'system',
    ]);
    // No family is interleaved with another.
    let cursor = -1;
    for (const family of families) {
      const rank = firstAppearance.indexOf(family);
      expect(rank).toBeGreaterThanOrEqual(cursor);
      cursor = rank;
    }
  });

  it('names every type family.action, lowercase snake after the dot', () => {
    for (const type of GAME_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+\.[a-z][a-z_]*$/);
    }
  });

  it('keeps every engine-only type inside the catalogue', () => {
    for (const type of ENGINE_ONLY_EVENT_TYPES) {
      expect(GAME_EVENT_TYPES).toContain(type);
    }
    expect(new Set(ENGINE_ONLY_EVENT_TYPES).size).toBe(ENGINE_ONLY_EVENT_TYPES.length);
  });

  it('opens no proposal kind that would let the model pick a price', () => {
    // Invariant 1, the precise shape it took in ARCHITECTURE.md section 4.4:
    // there is no `price_choice`, and opening one needs an ADR.
    expect(GM_PROPOSAL_KINDS).not.toContain('price_choice');
  });

  it('knows the four actor kinds', () => {
    expect([...ACTOR_KINDS]).toEqual(['player', 'engine', 'gm_ai', 'system']);
  });

  it('discriminates on `type` at compile time and at runtime', () => {
    // Narrowing on `type` gives the payload its exact shape; it would not
    // compile if the union were a plain `{ type: string; payload: unknown }`.
    // A `switch` is deliberately NOT used here: `switch-exhaustiveness-check`
    // demands all 71 branches even with a default, which is the whole point
    // of the union and the reducer's job, not this test's.
    const gaugeTouchedBy = (event: GameEvent): string => {
      if (event.type === 'character.gauge_changed') return event.payload.gauge;
      if (event.type === 'roll.price_paid') return event.payload.entryId;
      return 'other';
    };

    const event: GameEvent = {
      id: 'evt_1' as GameEvent['id'],
      campaignId: 'cmp_1' as GameEvent['campaignId'],
      seq: 1,
      playSessionId: null,
      payloadVersion: 1,
      actorKind: 'engine',
      actorPlayerId: null,
      subjectCharacterId: null,
      correlationId: null,
      causationId: null,
      rngStream: 'action',
      rngDrawIndex: 0,
      createdAt: 0,
      type: 'character.gauge_changed',
      payload: {
        characterId: 'chr_1' as never,
        gauge: 'vigueur',
        delta: -1,
        from: 5,
        to: 4,
        clamped: false,
        cause: 'move:face-danger/weak',
      },
    };

    expect(gaugeTouchedBy(event)).toBe('vigueur');
  });
});
