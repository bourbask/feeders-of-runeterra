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
 * THE CHAMPION IS ASHE, AND THAT IS A CONSTRAINT, NOT A TASTE. A reserved
 * champion is one PLAYED BY ANOTHER PLAYER of the table (02-mj-ia.md, section
 * « Champions interdits (réservés) »): the same champion cannot be both this
 * table's player character and reserved by someone else. So the default
 * character must be a champion ABSENT from `RESERVED_CHAMPIONS` — Ashe, whose
 * sheet M0-16 ships next to Braum's and Sejuani's.
 *
 * What it costs to get this wrong is not cosmetic. This package is what the
 * other tasks prove their own guardrails with: M0-21 (lockout) and M0-27
 * (eval N0) run `expectNoReservedChampion` over text built from these
 * fixtures. A default character named after a reserved champion makes that
 * assertion fire on a clean run — a red that checks nothing — and the day
 * somebody "fixes" it by loosening the assertion, it turns green on a real
 * leak. `champions.test.ts` holds this both ways.
 */

import type { CharacterState } from '@for/engine';

import { anId } from './ids.js';

/**
 * The champion every fixture character plays. ONE place, so `aCharacter`,
 * `aScenePresence` and any future fixture cannot drift apart — and so the
 * check « no fixture names a reserved champion » has a single thing to move.
 *
 * INVARIANT: this identifier and this name are absent from
 * `RESERVED_CHAMPIONS`. `champions.test.ts` measures it.
 */
export const FIXTURE_CHAMPION = { championId: 'ashe', displayName: 'Ashe' } as const;

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
    championId: FIXTURE_CHAMPION.championId,
    displayName: FIXTURE_CHAMPION.displayName,
    sheet: {
      championId: FIXTURE_CHAMPION.championId,
      source: 'handwritten',
      ref: `content:champions/${FIXTURE_CHAMPION.championId}@1.0.0`,
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
