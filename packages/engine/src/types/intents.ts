/**
 * `Intent` — what a client is allowed to ASK for.
 *
 * Invariant 3: the client only sends intentions. There is no `gauge.set`, no
 * `clock.advance`, no `price.apply`, no `narration.*` intent, and a proposal
 * for a new intent that would carry a RESULT is refused in review
 * (01-architecture.md section 5.3).
 */

import type { CharacterId, EntityId, RollId, TrackId } from '../ids.js';
import type { AttributeId, AttributeSpread } from './attributes.js';
import type { Likelihood } from './moves.js';
import type { ProgressRank } from './progress.js';

export interface MoveIntentBase {
  /** What the player wrote. Free French text, carried, never interpreted here. */
  readonly description: string;
  readonly bonus?: number | undefined;
}

export type Intent =
  /** A player attaching to their champion. */
  | { readonly type: 'campaign.join'; readonly characterId: CharacterId }
  | { readonly type: 'campaign.leave' }
  /**
   * Triggers the AI forge when the sheet is not handwritten. It goes through
   * the SAME journal as play: `character.created` is what sets the lock.
   */
  | {
      readonly type: 'character.create_draft';
      readonly championSlug: string;
      readonly spread: AttributeSpread;
      readonly background: string;
    }
  | ({ readonly type: 'move.face_danger'; readonly attribute: AttributeId } & MoveIntentBase)
  | ({ readonly type: 'move.secure_advantage'; readonly attribute: AttributeId } & MoveIntentBase)
  /** The attribute is forced to `esprit` by the engine, not chosen. */
  | ({ readonly type: 'move.gather_information' } & MoveIntentBase)
  | {
      readonly type: 'move.probe_a_soul';
      readonly target: ProbeTarget;
      readonly bonus?: number | undefined;
    }
  | {
      readonly type: 'move.strike';
      readonly targetId: string;
      readonly attribute: 'fer' | 'vif';
      readonly bonus?: number | undefined;
    }
  | { readonly type: 'move.endure_harm'; readonly amount?: number | undefined }
  | { readonly type: 'move.endure_cold' }
  | { readonly type: 'move.swear_a_vow'; readonly text: string; readonly rank: ProgressRank }
  | { readonly type: 'move.reach_a_milestone'; readonly trackId: TrackId }
  | { readonly type: 'move.fulfill_your_vow'; readonly trackId: TrackId }
  | { readonly type: 'move.forsake_your_vow'; readonly trackId: TrackId; readonly reason: string }
  /** Burn momentum on a roll whose window is still open. */
  | { readonly type: 'momentum.burn'; readonly rollId: RollId }
  /**
   * DECLINE the burn, and let the dice stand.
   *
   * The counterpart of `momentum.burn`, and the reason it exists: while the
   * window is open the move has rolled but NOT applied its consequences
   * (03-donnees.md section 3.4). Without a way to say no, a player who reads
   * the dice and shrugs leaves the turn hanging, and only the safety net --
   * the next entry about the same character -- would ever close it. Saying no
   * is a decision, so it is an intent, like saying yes.
   */
  | { readonly type: 'momentum.keep'; readonly rollId: RollId }
  | { readonly type: 'oracle.ask'; readonly question: string; readonly likelihood: Likelihood }
  | { readonly type: 'oracle.draw'; readonly oracleId: string }
  | { readonly type: 'speech.say'; readonly channel: 'ic' | 'ooc'; readonly text: string }
  | { readonly type: 'play_session.begin' }
  | { readonly type: 'play_session.end' };

/** Probing a soul targets either a known NPC or something merely described. */
export type ProbeTarget =
  | { readonly kind: 'entity'; readonly entityId: EntityId }
  | { readonly kind: 'description'; readonly text: string };

export const INTENT_TYPES = [
  'campaign.join',
  'campaign.leave',
  'character.create_draft',
  'move.face_danger',
  'move.secure_advantage',
  'move.gather_information',
  'move.probe_a_soul',
  'move.strike',
  'move.endure_harm',
  'move.endure_cold',
  'move.swear_a_vow',
  'move.reach_a_milestone',
  'move.fulfill_your_vow',
  'move.forsake_your_vow',
  'momentum.burn',
  'momentum.keep',
  'oracle.ask',
  'oracle.draw',
  'speech.say',
  'play_session.begin',
  'play_session.end',
] as const satisfies readonly Intent['type'][];

export type IntentType = (typeof INTENT_TYPES)[number];

/** Same compile guard as the event catalogue, in the other direction. */
type AssertNever<T extends never> = T;
export type IntentCatalogIsExhaustive = AssertNever<Exclude<Intent['type'], IntentType>>;
