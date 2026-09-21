/**
 * Progress tracks: vows, journeys, fights, scene challenges, bonds.
 *
 * A track holds ticks, four ticks to a box, ten boxes. Its rank decides how
 * many ticks one milestone is worth (03-donnees.md section 3.4).
 */

import type { CharacterId, TrackId } from '../ids.js';

export const PROGRESS_RANKS = ['genant', 'dangereux', 'redoutable', 'extreme', 'epique'] as const;

export type ProgressRank = (typeof PROGRESS_RANKS)[number];

/** Ticks granted by one milestone, by rank. */
export const TICKS_PER_MILESTONE: Readonly<Record<ProgressRank, number>> = {
  genant: 12,
  dangereux: 8,
  redoutable: 4,
  extreme: 2,
  epique: 1,
};

export const TICKS_PER_BOX = 4;
export const MAX_PROGRESS_BOXES = 10;
/** Ten full boxes. Every tick count is clamped here. */
export const MAX_PROGRESS_TICKS = TICKS_PER_BOX * MAX_PROGRESS_BOXES;

export const PROGRESS_TRACK_KINDS = [
  'vow',
  'combat',
  'journey',
  'scene_challenge',
  'bond',
] as const;

export type ProgressTrackKind = (typeof PROGRESS_TRACK_KINDS)[number];

export const PROGRESS_TRACK_STATUSES = [
  'open',
  'fulfilled',
  'forsaken',
  'failed',
  'abandoned',
] as const;

export type ProgressTrackStatus = (typeof PROGRESS_TRACK_STATUSES)[number];

/** Who may see a track or a clock. `gm` rows are stripped from a player view. */
export type Visibility = 'public' | 'gm';

export interface ProgressTrack {
  readonly id: TrackId;
  readonly kind: ProgressTrackKind;
  readonly rank: ProgressRank;
  readonly title: string;
  readonly description: string;
  /** `null` means a party-wide track. */
  readonly ownerCharacterId: CharacterId | null;
  readonly ticks: number;
  readonly status: ProgressTrackStatus;
  readonly visibility: Visibility;
  readonly tags: readonly string[];
  readonly createdSeq: number;
  readonly updatedSeq: number;
  readonly resolvedSeq: number | null;
}

/** The name `CampaignState` uses for a track. */
export type TrackState = ProgressTrack;
