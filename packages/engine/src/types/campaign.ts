/**
 * `CampaignState` — the root of game state.
 *
 * One TypeScript object, rebuilt by `reduce()` from the append-only journal.
 * Snapshots are a cache of it and nothing more (03-donnees.md section 3.5).
 */

import type { CampaignId, CharacterId, ClockId, EntityId, PlayerId, TrackId } from '../ids.js';
import type { RngStream } from '../rng.js';
import type { CharacterState } from './character.js';
import type { ClockState } from './clock.js';
import type { EntityState } from './entity.js';
import type { TrackState } from './progress.js';
import type { SceneState } from './scene.js';

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PARTY_ROLES = ['owner', 'player', 'spectator'] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

export const CHAMPION_LOCK_KINDS = ['reserved_pc', 'allowed_npc', 'banned'] as const;

export type ChampionLockKind = (typeof CHAMPION_LOCK_KINDS)[number];

export interface ChampionLock {
  readonly championId: string;
  readonly lockKind: ChampionLockKind;
  readonly reason: string;
  readonly setSeq: number;
}

export interface CampaignTruth {
  readonly truthId: string;
  readonly optionId: string;
  readonly customText: string | null;
}

/**
 * Per-campaign settings. Model names are ADAPTER DATA: nothing is hard-coded
 * here, and an empty value falls back to `NARRATOR_MODEL` then to the selected
 * adapter's default (ARCHITECTURE.md section 4.5).
 */
export interface CampaignSettings {
  readonly schemaVersion: 1;
  readonly models: {
    readonly narration: string | null;
    readonly structured: string | null;
  };
  readonly gmVerbosity: 'sobre' | 'standard' | 'ample';
  readonly oracleBias: 'clement' | 'neutre' | 'impitoyable';
  readonly safety: {
    /** Absolute bans. Player-authored French text, carried, never authored here. */
    readonly lines: readonly string[];
    /** Off-screen subjects. */
    readonly veils: readonly string[];
  };
  readonly allowForgedChampions: boolean;
  readonly requireForgeReview: boolean;
}

export interface PartyState {
  readonly memberPlayerIds: readonly PlayerId[];
  readonly ownerPlayerId: PlayerId;
}

/**
 * Draw bookkeeping. `draws` is the next index per stream and it is MONOTONE:
 * a reverted roll leaves its index consumed, so replaying an intent after a
 * cancellation does not give back the same dice (03-donnees.md section 3.6).
 */
export interface RngState {
  readonly seed: string;
  readonly draws: Readonly<Partial<Record<RngStream, number>>>;
}

export interface CampaignState {
  readonly campaignId: CampaignId;
  /** Last applied event. */
  readonly seq: number;
  readonly reducerVersion: number;
  readonly contentPackHash: string;
  readonly status: CampaignStatus;
  readonly settings: CampaignSettings;
  readonly truths: readonly CampaignTruth[];
  readonly characters: Readonly<Record<CharacterId, CharacterState>>;
  readonly tracks: Readonly<Record<TrackId, TrackState>>;
  readonly clocks: Readonly<Record<ClockId, ClockState>>;
  readonly entities: Readonly<Record<EntityId, EntityState>>;
  readonly championLocks: Readonly<Record<string, ChampionLock>>;
  /** `null` when no scene is open. */
  readonly scene: SceneState | null;
  readonly party: PartyState;
  readonly rng: RngState;
}
