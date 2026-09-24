/**
 * The three gauges and the momentum bounds.
 *
 * The bounds are mirrored by SQL CHECK constraints (03-donnees.md section 1.4).
 * That redundancy is deliberate: a reducer bug that pushed a gauge out of
 * range fails the transaction instead of being written.
 */

import { z } from 'zod';

import type { GaugeSet, MomentumBounds } from '@for/engine';

import { zGaugeId } from './enums.js';

export const GAUGE_MIN = 0;
export const GAUGE_MAX = 5;

export const zGaugeValue = z.number().int().min(GAUGE_MIN).max(GAUGE_MAX);

/** One value per gauge. Every gauge, every time: a partial set is refused. */
export const zGaugeSet = z.record(zGaugeId, zGaugeValue) satisfies z.ZodType<GaugeSet>;

/**
 * Per character, because a content asset may move them: state, not constants.
 */
export const zMomentumBounds = z.object({
  min: z.number().int(),
  max: z.number().int(),
  reset: z.number().int(),
}) satisfies z.ZodType<MomentumBounds>;
