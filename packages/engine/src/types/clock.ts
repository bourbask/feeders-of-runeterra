/**
 * Campaign clocks: the danger that rises off-screen.
 *
 * A clock has 4, 6, 8 or 10 segments. How far a turn advances one is bounded
 * by the outcome (ARCHITECTURE.md section 4.4) and computed by the engine, never
 * proposed as a number by the storyteller.
 */

import type { ClockId } from '../ids.js';
import type { Visibility } from './progress.js';

export const CLOCK_SEGMENT_COUNTS = [4, 6, 8, 10] as const;

export type ClockSegmentCount = (typeof CLOCK_SEGMENT_COUNTS)[number];

export const CLOCK_STATUSES = ['ticking', 'filled', 'resolved', 'cancelled'] as const;

export type ClockStatus = (typeof CLOCK_STATUSES)[number];

/** Segments a single turn may add, bounded by the outcome. */
export const CLOCK_ADVANCE_MIN = 1;
export const CLOCK_ADVANCE_MAX = 3;

export interface Clock {
  readonly id: ClockId;
  readonly title: string;
  readonly description: string;
  readonly segments: ClockSegmentCount;
  readonly filled: number;
  readonly status: ClockStatus;
  readonly visibility: Visibility;
  /** What happens when the clock saturates. Content text, not engine text. */
  readonly consequence: string;
  readonly createdSeq: number;
  readonly updatedSeq: number;
}

/** The name `CampaignState` uses for a clock. */
export type ClockState = Clock;
