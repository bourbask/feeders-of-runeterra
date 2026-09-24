/**
 * The three golden corpora of the rules.
 *
 * They are the reference oracle of the project: whoever changes a rule
 * constant gets a diff that NAMES what changed. That is the only requirement
 * they have to meet, and it is the reason for the shape below.
 *
 * WHY EACH ROW IS A STRING. `stableStringify` writes JSON with two-space
 * indentation, so a corpus of three hundred structured rows is four thousand
 * file lines, and its diff is unreadable — which means it stops being read, and
 * a corpus nobody reads proves nothing. One line per case, columns aligned,
 * gives a three-hundred-line file where a single changed outcome is a single
 * changed line. The `format` field of each corpus says how to read a row, so
 * the file explains itself to whoever opens it in a review.
 *
 * WHY THE MATRIX IS NOT A CARTESIAN PRODUCT. Every case below carries a
 * DECISION: a momentum bound, the equality `|momentum| == action die`, the
 * crossing of the cap at ten, equal challenge dice, or the three outcomes
 * around one threshold. A generated "wide" corpus would be bigger and prove
 * less.
 *
 * Each challenge row is produced by really calling `rollChallenge` with a
 * scripted generator, so the corpus is an assertion on the engine and not on a
 * second implementation of the rules written here.
 */

import { expectGolden, scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { ChallengeInput } from '../../src/dice/challenge.js';
import { rollChallenge } from '../../src/dice/challenge.js';
import { rollProgress } from '../../src/dice/progress.js';
import {
  applyMomentumDelta,
  burnMomentum,
  clampMomentum,
  isMomentumNegated,
} from '../../src/momentum.js';
import { boxesFilled, fillBoxes, markProgress } from '../../src/progress-track.js';
import type { MomentumBounds } from '../../src/types/gauges.js';
import { DEFAULT_MOMENTUM_BOUNDS } from '../../src/types/gauges.js';
import { MAX_PROGRESS_TICKS, PROGRESS_RANKS } from '../../src/types/progress.js';

const GOLDEN = { dir: new URL('.', import.meta.url) };

/** Signed, fixed width: `+02`, `-06`. Alignment is what makes a diff readable. */
function signed(value: number, width = 2): string {
  return `${value < 0 ? '-' : '+'}${String(Math.abs(value)).padStart(width, '0')}`;
}

function padded(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function yesNo(value: boolean): string {
  return value ? 'y' : 'n';
}

// --------------------------------------------------------------- challenge

interface ChallengeCase extends ChallengeInput {
  readonly actionDie: number;
  readonly challengeDice: readonly [number, number];
}

const CHALLENGE_FORMAT =
  'att=<attribute> bon=<bonus> mom=<momentum> burn=<asked> | ' +
  'd6=<action die> dA=<challenge> dB=<challenge> | ' +
  'neg=<action die cancelled> raw=<raw score> sco=<score> cap=<capped at ten> ' +
  'brn=<burned> | <outcome> pres=<presage>';

function challengeRow(entry: ChallengeCase): string {
  const input: ChallengeInput = {
    attribute: entry.attribute,
    bonus: entry.bonus,
    momentum: entry.momentum,
    burnMomentum: entry.burnMomentum,
  };
  const roll = rollChallenge(
    input,
    scriptedRng([entry.actionDie, entry.challengeDice[0], entry.challengeDice[1]]),
  );

  return (
    `att=${String(entry.attribute)} bon=${signed(entry.bonus)} mom=${signed(entry.momentum)} ` +
    `burn=${yesNo(entry.burnMomentum)} | ` +
    `d6=${String(roll.actionDie)} dA=${padded(roll.challengeDice[0])} ` +
    `dB=${padded(roll.challengeDice[1])} | ` +
    `neg=${yesNo(roll.momentumCancelled)} raw=${signed(roll.rawScore)} sco=${signed(roll.score)} ` +
    `cap=${yesNo(roll.score !== roll.rawScore && !roll.burned)} brn=${yesNo(roll.burned)} | ` +
    `${roll.outcome.padEnd(9)} pres=${yesNo(roll.presage)}`
  );
}

/** A case whose score is exactly `score` before the cap: d6 = 1, attribute = 1. */
function atScore(
  score: number,
  challengeDice: readonly [number, number],
  overrides: Partial<ChallengeCase> = {},
): ChallengeCase {
  return {
    attribute: 1,
    bonus: score - 2,
    momentum: 2,
    burnMomentum: false,
    actionDie: 1,
    challengeDice,
    ...overrides,
  };
}

function challengeCases(): ChallengeCase[] {
  const cases: ChallengeCase[] = [];
  const dice = (a: number, b: number): readonly [number, number] => [a, b];

  // 1. The momentum bounds named by the specification, against every face of
  //    the action die: -6, -1, 0, +1, +2, +9, +10.
  for (const momentum of [-6, -1, 0, 1, 2, 9, 10]) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 2,
        bonus: 0,
        momentum,
        burnMomentum: false,
        actionDie,
        challengeDice: dice(4, 7),
      });
    }
  }

  // 2. |momentum| == action die, over the whole negative range: the six rows
  //    where the die is cancelled, and the thirty where it is not.
  for (let momentum = -1; momentum >= -6; momentum -= 1) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 2,
        bonus: 1,
        momentum,
        burnMomentum: false,
        actionDie,
        challengeDice: dice(3, 8),
      });
    }
  }

  // 3. Crossing the ceiling at ten.
  for (const bonus of [2, 3, 4, 5, 6]) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 3,
        bonus,
        momentum: 2,
        burnMomentum: false,
        actionDie,
        challengeDice: dice(8, 9),
      });
    }
  }

  // 4. The three outcomes around each threshold: against [p, p+1], a score of
  //    p misses, p+1 is partial, p+2 is clean.
  for (let pivot = 1; pivot <= 9; pivot += 1) {
    for (const score of [pivot, pivot + 1, pivot + 2]) {
      cases.push(atScore(score, dice(pivot, pivot + 1)));
    }
  }

  // 5. Equal challenge dice, every face, from the bottom and from the top.
  for (let face = 1; face <= 10; face += 1) {
    cases.push(atScore(1, dice(face, face)), atScore(10, dice(face, face)));
  }

  // 6. Burning, over the momentum range, against a low score and a capped one.
  for (const momentum of [-6, -1, 0, 1, 2, 3, 5, 9, 10]) {
    cases.push(
      {
        attribute: 1,
        bonus: 1,
        momentum,
        burnMomentum: true,
        actionDie: 1,
        challengeDice: dice(4, 6),
      },
      {
        attribute: 3,
        bonus: 6,
        momentum,
        burnMomentum: true,
        actionDie: 1,
        challengeDice: dice(4, 6),
      },
    );
  }

  // 7. The attribute range against a negative, null and positive bonus.
  for (const attribute of [1, 2, 3]) {
    for (const bonus of [-2, 0, 2]) {
      for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
        cases.push({
          attribute,
          bonus,
          momentum: 2,
          burnMomentum: false,
          actionDie,
          challengeDice: dice(5, 6),
        });
      }
    }
  }

  // 8. One challenge die sweeping past a fixed score, the other held low: the
  //    outcome walks from franche to partielle as the sweeping die passes.
  for (let face = 1; face <= 10; face += 1) {
    cases.push(atScore(6, dice(face, 2)));
  }

  // 9. Penalties down to a negative score: `min(rawScore, 10)` has no floor.
  for (const bonus of [-3, -2, -1, 0]) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 1,
        bonus,
        momentum: 0,
        burnMomentum: false,
        actionDie,
        challengeDice: dice(2, 3),
      });
    }
  }

  // 10. A burn asked for on a roll that is already at the ceiling.
  for (const bonus of [0, 3, 6]) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 3,
        bonus,
        momentum: 10,
        burnMomentum: true,
        actionDie,
        challengeDice: dice(7, 7),
      });
    }
  }

  // 11. A presage on a capped roll, every face.
  for (let face = 1; face <= 10; face += 1) {
    cases.push({
      attribute: 3,
      bonus: 6,
      momentum: 2,
      burnMomentum: false,
      actionDie: 6,
      challengeDice: dice(face, face),
    });
  }

  // 12. Deeply penalised rolls, where the score goes below zero.
  for (const bonus of [-8, -6, -4]) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      cases.push({
        attribute: 1,
        bonus,
        momentum: 0,
        burnMomentum: false,
        actionDie,
        challengeDice: dice(1, 1),
      });
    }
  }

  return cases;
}

// ---------------------------------------------------------------- momentum

const MOMENTUM_FORMAT =
  'clamp  value=<v> -> <clamped> | ' +
  'delta  mom=<m> d=<delta> -> mom=<m> applied=<a> clamped=<y/n> | ' +
  'negate mom=<m> d6=<die> -> <y/n> | ' +
  'burn   mom=<m> sco=<score> -> burned=<y/n> sco=<score> mom=<m>';

const WIDENED: MomentumBounds = { min: -8, max: 12, reset: 3 };
const NARROWED: MomentumBounds = { min: -2, max: 5, reset: 1 };

function boundsLabel(bounds: MomentumBounds): string {
  return `${signed(bounds.min)}..${signed(bounds.max)}/r${signed(bounds.reset)}`;
}

function momentumRows(): string[] {
  const rows: string[] = [];

  for (const bounds of [DEFAULT_MOMENTUM_BOUNDS, WIDENED, NARROWED]) {
    for (let value = -9; value <= 13; value += 1) {
      rows.push(
        `clamp  value=${signed(value)} bounds=${boundsLabel(bounds)} -> ` +
          signed(clampMomentum(value, bounds)),
      );
    }
  }

  for (const momentum of [-6, -3, 0, 2, 9, 10]) {
    for (const delta of [-9, -3, -1, 0, 1, 3, 9]) {
      const change = applyMomentumDelta(momentum, delta, DEFAULT_MOMENTUM_BOUNDS);
      rows.push(
        `delta  mom=${signed(momentum)} d=${signed(delta)} -> mom=${signed(change.momentum)} ` +
          `applied=${signed(change.applied)} clamped=${yesNo(change.clamped)}`,
      );
    }
  }

  for (let momentum = -6; momentum <= 2; momentum += 1) {
    for (let actionDie = 1; actionDie <= 6; actionDie += 1) {
      rows.push(
        `negate mom=${signed(momentum)} d6=${String(actionDie)} -> ` +
          yesNo(isMomentumNegated(momentum, actionDie)),
      );
    }
  }

  for (const momentum of [-2, 0, 1, 2, 5, 9, 10]) {
    for (const score of [-3, 0, 1, 2, 5, 9, 10]) {
      const burn = burnMomentum(momentum, score, DEFAULT_MOMENTUM_BOUNDS);
      rows.push(
        `burn   mom=${signed(momentum)} sco=${signed(score)} -> burned=${yesNo(burn.burned)} ` +
          `sco=${signed(burn.score)} mom=${signed(burn.momentum)}`,
      );
    }
  }

  return rows;
}

// ---------------------------------------------------------------- progress

const PROGRESS_FORMAT =
  'mark  rank=<rank> from=<ticks> x<milestones> -> ticks=<t> boxes=<b> applied=<a> full=<y/n> | ' +
  'boxes ticks=<t> -> <complete boxes> | ' +
  'fill  from=<ticks> boxes=<n> -> ticks=<t> boxes=<b> applied=<a> full=<y/n> | ' +
  'roll  boxes=<b> dA=<challenge> dB=<challenge> -> <outcome> pres=<presage>';

function progressRows(): string[] {
  const rows: string[] = [];

  // One milestone at a time, from empty, until the track is full or six marks
  // have passed. This is the family that carries TICKS_PER_MILESTONE: change a
  // single rank and only that rank's lines move.
  for (const rank of PROGRESS_RANKS) {
    let ticks = 0;
    for (let mark = 1; mark <= 6; mark += 1) {
      const from = ticks;
      const change = markProgress(ticks, rank);
      ticks = change.ticks;
      rows.push(
        `mark  rank=${rank.padEnd(10)} from=${padded(from)} x1 -> ` +
          `ticks=${padded(change.ticks)} boxes=${padded(change.filledBoxes)} ` +
          `applied=${signed(change.ticksApplied)} full=${yesNo(change.complete)}`,
      );
    }
  }

  // Several milestones at once, and backwards.
  for (const rank of PROGRESS_RANKS) {
    for (const milestones of [-2, -1, 2, 3]) {
      const change = markProgress(20, rank, milestones);
      rows.push(
        `mark  rank=${rank.padEnd(10)} from=20 x${signed(milestones, 1)} -> ` +
          `ticks=${padded(change.ticks)} boxes=${padded(change.filledBoxes)} ` +
          `applied=${signed(change.ticksApplied)} full=${yesNo(change.complete)}`,
      );
    }
  }

  for (let ticks = 0; ticks <= MAX_PROGRESS_TICKS; ticks += 1) {
    rows.push(`boxes ticks=${padded(ticks)} -> ${padded(boxesFilled(ticks))}`);
  }

  for (const from of [0, 3, 4, 17, 36, 39]) {
    for (const boxes of [-3, -1, 1, 2, 3, 10]) {
      const change = fillBoxes(from, boxes);
      rows.push(
        `fill  from=${padded(from)} boxes=${signed(boxes, 1)} -> ticks=${padded(change.ticks)} ` +
          `boxes=${padded(change.filledBoxes)} applied=${signed(change.ticksApplied)} ` +
          `full=${yesNo(change.complete)}`,
      );
    }
  }

  const diceShapes: readonly (readonly [number, number])[] = [
    [1, 1],
    [5, 5],
    [10, 10],
    [3, 7],
    [7, 3],
    [9, 10],
  ];
  for (let filled = 0; filled <= 10; filled += 1) {
    for (const [a, b] of diceShapes) {
      const roll = rollProgress(filled, scriptedRng([a, b]));
      rows.push(
        `roll  boxes=${padded(filled)} dA=${padded(a)} dB=${padded(b)} -> ` +
          `${roll.outcome.padEnd(9)} pres=${yesNo(roll.presage)}`,
      );
    }
  }

  return rows;
}

// ------------------------------------------------------------------- suite

describe('the golden corpora of the rules', () => {
  it('pins the challenge matrix', () => {
    const rows = challengeCases().map(challengeRow);

    // A corpus that shrank to nothing would still compare equal to a corpus
    // that shrank to nothing. The count is asserted here, not in the file.
    expect(rows.length).toBeGreaterThanOrEqual(280);
    expect(rows.length).toBeLessThanOrEqual(340);
    expect(new Set(rows).size).toBe(rows.length);

    expectGolden('challenge-matrix', { format: CHALLENGE_FORMAT, rows }, GOLDEN);
  });

  it('pins the momentum rules', () => {
    const rows = momentumRows();
    expect(rows.length).toBeGreaterThanOrEqual(150);
    expectGolden('momentum-rules', { format: MOMENTUM_FORMAT, rows }, GOLDEN);
  });

  it('pins the progress rolls', () => {
    const rows = progressRows();
    expect(rows.length).toBeGreaterThanOrEqual(150);
    expectGolden('progress-rolls', { format: PROGRESS_FORMAT, rows }, GOLDEN);
  });
});

describe('what the challenge matrix is an oracle for', () => {
  it('covers the momentum bounds, the cap, the cancellation and the presage', () => {
    // Each of these is a decision the matrix exists to pin down. If a family
    // above is ever deleted, this test says which one rather than leaving a
    // smaller corpus passing quietly.
    const rows = challengeCases().map(challengeRow);
    const count = (predicate: (row: string) => boolean): number => rows.filter(predicate).length;

    expect(count((row) => row.includes('mom=-06'))).toBeGreaterThan(0);
    expect(count((row) => row.includes('mom=+10'))).toBeGreaterThan(0);
    expect(count((row) => row.includes('neg=y'))).toBeGreaterThanOrEqual(6);
    expect(count((row) => row.includes('cap=y'))).toBeGreaterThan(0);
    expect(count((row) => row.includes('brn=y'))).toBeGreaterThan(0);
    expect(count((row) => row.includes('pres=y'))).toBeGreaterThanOrEqual(20);
    for (const outcome of ['franche', 'partielle', 'echec']) {
      expect(count((row) => row.includes(`| ${outcome}`))).toBeGreaterThan(0);
    }
  });

  it('uses every rank of the progress table', () => {
    const rows = progressRows();
    for (const rank of PROGRESS_RANKS) {
      expect(rows.filter((row) => row.includes(`rank=${rank}`)).length).toBeGreaterThan(0);
    }
  });
});
