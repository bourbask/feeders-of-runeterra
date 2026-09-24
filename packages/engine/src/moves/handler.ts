/**
 * What a move handler is, and the two or three lines every one of them shares.
 *
 * A HANDLER DECIDES NOTHING ABOUT CONSEQUENCES. It answers three questions the
 * content file cannot:
 *
 *   1. may this character play this move right now (a `RuleViolation`, never
 *      an exception — 01-architecture.md section 3.3);
 *   2. which roll does it make, on which attribute or which track;
 *   3. what does the move impose on top of the content's outcome effects —
 *      the harm already taken in `endure-harm`, the vow a `swear-a-vow` opens.
 *
 * Everything else — gauges, momentum, conditions, ticks, the price — is
 * declared by `content/moves/*.json` as `EngineEffect`s and executed by the
 * one executor in `decide.ts`. That is what keeps a move from becoming a
 * second place where the rules live.
 */

import type { TrackId } from '../ids.js';
import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import type { AttributeId } from '../types/attributes.js';
import type { CampaignState } from '../types/campaign.js';
import type { CharacterState } from '../types/character.js';
import type { EngineEffect } from '../types/effects.js';
import type { Intent } from '../types/intents.js';
import type { MoveId, Outcome } from '../types/moves.js';
import type { ProgressRank, TrackState } from '../types/progress.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveDefinition } from './content.js';

/** The intents that play a move. Eleven of them, one per `MoveId`. */
export type MoveIntent = Extract<Intent, { readonly type: `move.${string}` }>;

/** What a handler is given. Everything it may read, and nothing it may write. */
export interface MovePlanInput<TIntent extends MoveIntent = MoveIntent> {
  readonly state: CampaignState;
  readonly character: CharacterState;
  readonly definition: MoveDefinition;
  readonly intent: TIntent;
}

/**
 * The roll a move makes.
 *
 * `none` still carries an `outcome`, because a move without a roll still picks
 * a branch of `outcomes` in the content file. `reach-a-milestone` marks its
 * progress on the `franche` branch: there is nothing to beat, so there is
 * nothing to fail.
 */
export type PlannedRoll =
  | { readonly kind: 'action'; readonly attribute: AttributeId; readonly bonus: number }
  | { readonly kind: 'progress'; readonly trackId: TrackId }
  | { readonly kind: 'none'; readonly outcome: Outcome };

/**
 * How the track this move acts on ends.
 *
 * NO XP NUMBER HERE. What a fulfilled vow is worth is content (`{ op: 'xp' }`
 * on the outcome), not a table hidden in the engine: a rank-to-XP ladder
 * written here would be a rule no specification carries, which is the mistake
 * `gauges.ts` refuses in the same words.
 */
export type TrackResolution =
  | { readonly kind: 'resolved'; readonly outcome: 'fulfilled' | 'failed' }
  | { readonly kind: 'forsaken' };

export interface MovePlan {
  readonly roll: PlannedRoll;
  /** What the player wrote, carried verbatim into `move.declared`. */
  readonly narrativeInput: string;
  /** The track this move acts on, when it has one. */
  readonly trackId: TrackId | null;
  /** Rank the player asked for, for a `track_create` with `rankFrom: 'player'`. */
  readonly playerRank: ProgressRank | null;
  /** Title of a track this move opens. Player text, carried, never read. */
  readonly trackTitle: string;
  /** Imposed before the roll, whatever it gives. Harm already taken. */
  readonly upfrontEffects: readonly EngineEffect[];
  /** Per outcome: how `trackId` ends, or `null` when it stays open. */
  readonly resolution: Readonly<Record<Outcome, TrackResolution | null>>;
}

export interface MoveHandler<TIntent extends MoveIntent = MoveIntent> {
  readonly id: MoveId;
  /** The intent that plays this move. One to one, checked by `index.ts`. */
  readonly intentType: TIntent['type'];
  plan(input: MovePlanInput<TIntent>): Result<MovePlan, RuleViolation>;
}

/** No track touched, on any outcome. The shape every plain move uses. */
export const NO_RESOLUTION: Readonly<Record<Outcome, TrackResolution | null>> = {
  franche: null,
  partielle: null,
  echec: null,
};

/** A plan with every optional part at its empty value. */
export function planOf(roll: PlannedRoll, narrativeInput: string): MovePlan {
  return {
    roll,
    narrativeInput,
    trackId: null,
    playerRank: null,
    trackTitle: '',
    upfrontEffects: [],
    resolution: NO_RESOLUTION,
  };
}

/**
 * The attribute a move keys on.
 *
 * Two readings, and the second one is the one that keeps the rules in the
 * content file: when the intent names an attribute, it must be one the move
 * OFFERS (`attribute_not_allowed`); when it names none, the move keys on the
 * FIRST attribute the content lists. `content/moves/*.json` is then the single
 * place that decides, and `endure-cold` changing its default is a content
 * edit, not a release.
 */
export function chooseAttribute(
  definition: MoveDefinition,
  chosen: AttributeId | undefined,
): Result<AttributeId, RuleViolation> {
  const [fallback] = definition.attributeOptions;
  if (chosen === undefined) {
    if (fallback === undefined) {
      return err({
        code: 'unknown_move',
        details: { moveId: definition.id, reason: 'no_attribute' },
      });
    }
    return ok(fallback);
  }
  if (!definition.attributeOptions.includes(chosen)) {
    return err({
      code: 'attribute_not_allowed',
      details: { moveId: definition.id, attribute: chosen },
    });
  }
  return ok(chosen);
}

/** Additional modifiers a move intent may carry. Absent means none. */
export function bonusOf(intent: { readonly bonus?: number | undefined }): number {
  return intent.bonus ?? 0;
}

/**
 * The vow this move acts on, or the reason it cannot.
 *
 * Three refusals, in the order a player meets them: the track does not exist,
 * it is not a vow, it is already closed.
 */
export function requireOpenVow(
  state: CampaignState,
  trackId: TrackId,
): Result<TrackState, RuleViolation> {
  const track = state.tracks[trackId];
  if (track === undefined) {
    return err({ code: 'unknown_track', details: { trackId } });
  }
  if (track.kind !== 'vow') {
    return err({ code: 'track_wrong_kind', details: { trackId, kind: track.kind } });
  }
  if (track.status !== 'open') {
    return err({ code: 'track_already_resolved', details: { trackId, status: track.status } });
  }
  return ok(track);
}
