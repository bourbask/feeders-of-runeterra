/**
 * `aCharacter()` — a complete character sheet state, every field filled.
 *
 * The transverse rule of 01-architecture.md section 7.2: NO test writes a
 * table state by hand. A literal `CharacterState` in a test file is a promise
 * to edit fifty files the day the engine grows a field.
 *
 * "Complete defaults" is the whole contract of this builder, and it means two
 * things at once:
 *
 *   - no argument is required: `aCharacter()` alone parses against
 *     `zCharacterState`;
 *   - nothing is left to chance or to the clock. The attribute spread is the
 *     only legal one (3/2/2/1/1, `zAttributeSpread`), the gauges are the full
 *     set of three, and the momentum bounds are the -6 / +10 / 2 of the rules.
 *
 * The champion is Braum because M0 ships his sheet first, and because a
 * character named after a RESERVED champion is what
 * `expectNoReservedChampion` is there to catch: a fixture that quietly used
 * `Sejuani` would make that assertion fire on half the suite.
 */

import type { CharacterState } from '@for/engine';

import { anId } from './ids.js';

/** Both bounds of the rules, plus the value a burn resets to. */
export const FIXTURE_MOMENTUM_BOUNDS = { min: -6, max: 10, reset: 2 } as const;

/** A full gauge set: the three gauges at their starting value. */
export const FIXTURE_GAUGES = { vigueur: 5, ame: 5, vivres: 5 } as const;

/** 3/2/2/1/1, the only legal spread at creation (`zAttributeSpread`). */
export const FIXTURE_ATTRIBUTES = { vif: 2, coeur: 3, fer: 2, ombre: 1, esprit: 1 } as const;

/** Every field of `CharacterState`, each one optional. */
export type CharacterOverrides = { readonly [K in keyof CharacterState]?: CharacterState[K] };

/**
 * @param overrides the fields this test actually cares about. Everything else
 * gets a default that parses.
 */
export function aCharacter(overrides: CharacterOverrides = {}): CharacterState {
  const base: CharacterState = {
    id: anId('character'),
    playerId: anId('player'),
    championId: 'braum',
    displayName: 'Braum',
    sheet: {
      championId: 'braum',
      source: 'handwritten',
      ref: 'content:champions/braum@1.0.0',
    },
    attributes: FIXTURE_ATTRIBUTES,
    gauges: FIXTURE_GAUGES,
    momentum: FIXTURE_MOMENTUM_BOUNDS.reset,
    momentumBounds: FIXTURE_MOMENTUM_BOUNDS,
    xpEarned: 0,
    xpSpent: 0,
    conditions: [],
    assets: [],
    status: 'active',
    createdSeq: 1,
    updatedSeq: 1,
  };

  return { ...base, ...overrides };
}
