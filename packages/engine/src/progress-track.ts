/**
 * Progress tracks: ten boxes of four ticks, and the rank that sets the pace.
 *
 * | rank         | ticks per milestone |
 * |--------------|---------------------|
 * | `genant`     | 12                  |
 * | `dangereux`  | 8                   |
 * | `redoutable` | 4                   |
 * | `extreme`    | 2                   |
 * | `epique`     | 1                   |
 *
 * The table itself lives in `types/progress.ts` (`TICKS_PER_MILESTONE`) and is
 * NOT copied here. That constant is the one the golden corpus is an oracle for:
 * change a single number in it and `progress-rolls.golden.json` goes red with a
 * diff that names the rank.
 *
 * Everything below works in TICKS and derives boxes, never the reverse. Boxes
 * are a reading of the tick count; storing boxes separately is how a track ends
 * up with nine boxes and thirty-eight ticks.
 */

import type { ProgressRank } from './types/progress.js';
import {
  MAX_PROGRESS_BOXES,
  MAX_PROGRESS_TICKS,
  TICKS_PER_BOX,
  TICKS_PER_MILESTONE,
} from './types/progress.js';

/** `ticks`, brought back inside `[0, MAX_PROGRESS_TICKS]`. */
export function clampTicks(ticks: number): number {
  if (ticks < 0) return 0;
  if (ticks > MAX_PROGRESS_TICKS) return MAX_PROGRESS_TICKS;
  return ticks;
}

/**
 * Complete boxes, 0..10. A partially filled box does not count: it is the
 * number the progress roll compares against the challenge dice, and three
 * ticks are not a box.
 */
export function boxesFilled(ticks: number): number {
  return Math.floor(clampTicks(ticks) / TICKS_PER_BOX);
}

/** Ticks still missing before the track is full. */
export function ticksRemaining(ticks: number): number {
  return MAX_PROGRESS_TICKS - clampTicks(ticks);
}

/** What `milestones` milestones are worth at this rank. */
export function ticksForMilestones(rank: ProgressRank, milestones: number): number {
  return TICKS_PER_MILESTONE[rank] * milestones;
}

export interface ProgressChange {
  readonly ticks: number;
  readonly filledBoxes: number;
  /** Ticks that actually landed, once the ceiling had its say. */
  readonly ticksApplied: number;
  /** The track reached its tenth box. */
  readonly complete: boolean;
}

function changeFrom(before: number, after: number): ProgressChange {
  const ticks = clampTicks(after);
  return {
    ticks,
    filledBoxes: boxesFilled(ticks),
    ticksApplied: ticks - clampTicks(before),
    complete: ticks === MAX_PROGRESS_TICKS,
  };
}

/**
 * Mark progress: one milestone at this rank, or several.
 *
 * `milestones` may be negative — a vow that loses ground marks backwards, and
 * the floor at zero is the same rule as the ceiling at forty.
 */
export function markProgress(ticks: number, rank: ProgressRank, milestones = 1): ProgressChange {
  return changeFrom(ticks, ticks + ticksForMilestones(rank, milestones));
}

/**
 * Fill whole boxes, ignoring the rank.
 *
 * This is the rank-free path: an effect that says "fill two boxes" says exactly
 * that, whatever the track's pace. Keeping it apart from `markProgress` is what
 * stops a caller from expressing it as a milestone count and getting a
 * different answer on a `genant` track than on an `epique` one.
 */
export function fillBoxes(ticks: number, boxes: number): ProgressChange {
  return changeFrom(ticks, ticks + boxes * TICKS_PER_BOX);
}

/** Ticks a full track holds, as a reading of the two constants that set it. */
export function fullTrackTicks(): number {
  return MAX_PROGRESS_BOXES * TICKS_PER_BOX;
}
