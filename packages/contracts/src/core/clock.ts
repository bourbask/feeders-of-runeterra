/**
 * Campaign clocks: the danger that rises off-screen.
 *
 * How far one turn advances a clock is bounded by the outcome and computed by
 * the engine, never proposed as a number by the storyteller
 * (ARCHITECTURE.md section 4.4).
 */

import { z } from 'zod';

import type { Clock } from '@for/engine';

import { zClockId, zSeq } from '../primitives.js';
import { zClockSegmentCount, zClockStatus, zVisibility } from './enums.js';

/** Segments a single turn may add. */
export const CLOCK_ADVANCE_MIN = 1;
export const CLOCK_ADVANCE_MAX = 3;

export const zClockAdvance = z.number().int().min(CLOCK_ADVANCE_MIN).max(CLOCK_ADVANCE_MAX);

export const zClock = z.object({
  id: zClockId,
  title: z.string(),
  description: z.string(),
  segments: zClockSegmentCount,
  filled: z.number().int().nonnegative(),
  status: zClockStatus,
  visibility: zVisibility,
  /** Content text, not engine text. */
  consequence: z.string(),
  createdSeq: zSeq,
  updatedSeq: zSeq,
}) satisfies z.ZodType<Clock>;

/** The name `CampaignState` uses for a clock. */
export const zClockState = zClock;

export type ClockDto = z.output<typeof zClock>;
