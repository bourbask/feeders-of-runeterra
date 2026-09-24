/**
 * `track.*` and `clock.*` payloads.
 *
 * Rule encoded on the engine side, not here: a milestone is worth 12 ticks at
 * *genant*, 8 at *dangereux*, 4 at *redoutable*, 2 at *extreme*, 1 at
 * *epique*, and `ticks` is clamped to 40 (ten full boxes). This file states
 * the SHAPE; the arithmetic belongs to `@for/engine` (M0-07).
 */

import { z } from 'zod';

import type {
  ClockAdvancedPayload,
  ClockCancelledPayload,
  ClockCreatedPayload,
  ClockFilledPayload,
  ClockResolvedPayload,
  TrackAbandonedPayload,
  TrackCreatedPayload,
  TrackForsakenPayload,
  TrackRankChangedPayload,
  TrackResolvedPayload,
  TrackTickedPayload,
} from '@for/engine';

import {
  zClockSegmentCount,
  zProgressRank,
  zProgressTrackKind,
  zVisibility,
} from '../core/enums.js';
import { zTicks } from '../core/progress-track.js';
import { zCharacterId, zClockId, zEventCause, zSeq, zTrackId } from '../primitives.js';

export const zTrackCreatedPayload = z.object({
  trackId: zTrackId,
  kind: zProgressTrackKind,
  rank: zProgressRank,
  title: z.string(),
  description: z.string(),
  /** Absent means a party-wide track. */
  ownerCharacterId: zCharacterId.optional(),
  visibility: zVisibility,
  initialTicks: zTicks,
}) satisfies z.ZodType<TrackCreatedPayload>;

export const zTrackTickedPayload = z.object({
  trackId: zTrackId,
  ticks: z.number().int(),
  from: zTicks,
  to: zTicks,
  cause: zEventCause,
  milestones: z.number().int(),
}) satisfies z.ZodType<TrackTickedPayload>;

export const zTrackRankChangedPayload = z.object({
  trackId: zTrackId,
  from: zProgressRank,
  to: zProgressRank,
  reason: z.string(),
}) satisfies z.ZodType<TrackRankChangedPayload>;

export const zTrackResolvedPayload = z.object({
  trackId: zTrackId,
  outcome: z.enum(['fulfilled', 'failed']),
  rollSeq: zSeq,
  xpAwarded: z.number().int(),
}) satisfies z.ZodType<TrackResolvedPayload>;

export const zTrackForsakenPayload = z.object({
  trackId: zTrackId,
  reason: z.string(),
  xpLost: z.number().int(),
}) satisfies z.ZodType<TrackForsakenPayload>;

/** Out of fiction: housekeeping. */
export const zTrackAbandonedPayload = z.object({
  trackId: zTrackId,
  reason: z.string(),
}) satisfies z.ZodType<TrackAbandonedPayload>;

export const zClockCreatedPayload = z.object({
  clockId: zClockId,
  title: z.string(),
  description: z.string(),
  segments: zClockSegmentCount,
  visibility: zVisibility,
  /** Content text: what happens when the clock saturates. */
  consequence: z.string(),
}) satisfies z.ZodType<ClockCreatedPayload>;

export const zClockAdvancedPayload = z.object({
  clockId: zClockId,
  delta: z.number().int(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  cause: zEventCause,
}) satisfies z.ZodType<ClockAdvancedPayload>;

export const zClockFilledPayload = z.object({
  clockId: zClockId,
  consequence: z.string(),
}) satisfies z.ZodType<ClockFilledPayload>;

export const zClockResolvedPayload = z.object({
  clockId: zClockId,
  resolution: z.string(),
}) satisfies z.ZodType<ClockResolvedPayload>;

export const zClockCancelledPayload = z.object({
  clockId: zClockId,
  reason: z.string(),
}) satisfies z.ZodType<ClockCancelledPayload>;
