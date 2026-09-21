/**
 * A vow is a progress track of kind `vow`, seen through the lens the rules
 * actually use: whose vow it is, what rank, how far along.
 *
 * It is a VIEW over `ProgressTrack`, not a second storage: two shapes for the
 * same fact drift within a fortnight.
 */

import type { CharacterId, TrackId } from '../ids.js';
import type { ProgressRank, ProgressTrack, ProgressTrackStatus } from './progress.js';

export interface Vow {
  readonly trackId: TrackId;
  readonly title: string;
  readonly rank: ProgressRank;
  readonly ticks: number;
  readonly status: ProgressTrackStatus;
  /** `null` for a vow sworn by the whole party. */
  readonly ownerCharacterId: CharacterId | null;
}

/** The three moves that close a vow. */
export const VOW_RESOLUTION_MOVES = [
  'fulfill-your-vow',
  'reach-a-milestone',
  'forsake-your-vow',
] as const;

export type VowResolutionMoveId = (typeof VOW_RESOLUTION_MOVES)[number];

/** Narrowing helper: a track that is a vow. */
export type VowTrack = ProgressTrack & { readonly kind: 'vow' };
