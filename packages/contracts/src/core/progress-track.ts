/**
 * Progress tracks: vows, journeys, fights, scene challenges, bonds.
 *
 * Four ticks to a box, ten boxes. `MAX_PROGRESS_TICKS` is the ceiling every
 * tick count is clamped to (03-donnees.md section 3.4).
 */

import { z } from 'zod';

import type { ProgressTrack } from '@for/engine';

import { zCharacterId, zSeq, zSlug, zTrackId } from '../primitives.js';
import { zProgressRank, zProgressTrackKind, zProgressTrackStatus, zVisibility } from './enums.js';

export const TICKS_PER_BOX = 4;
export const MAX_PROGRESS_BOXES = 10;
/** Ten full boxes. */
export const MAX_PROGRESS_TICKS = TICKS_PER_BOX * MAX_PROGRESS_BOXES;

export const zTicks = z.number().int().min(0).max(MAX_PROGRESS_TICKS);

export const zProgressTrack = z.object({
  id: zTrackId,
  kind: zProgressTrackKind,
  rank: zProgressRank,
  title: z.string(),
  description: z.string(),
  /** `null` means a party-wide track, not an absent one. */
  ownerCharacterId: zCharacterId.nullable(),
  ticks: zTicks,
  status: zProgressTrackStatus,
  visibility: zVisibility,
  tags: z.array(zSlug),
  createdSeq: zSeq,
  updatedSeq: zSeq,
  resolvedSeq: zSeq.nullable(),
}) satisfies z.ZodType<ProgressTrack>;

/** The name `CampaignState` uses for a track. */
export const zTrackState = zProgressTrack;

export type ProgressTrackDto = z.output<typeof zProgressTrack>;
